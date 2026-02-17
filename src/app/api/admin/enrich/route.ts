import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { markStarted, addPid, appendLog, updateProcessFields, markDone } from '@/lib/admin/process-store';

const CONCURRENCY = 30;

interface EnrichRequest {
  files: Array<{ path: string; absolutePath: string }>;
  model?: string;
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
  promptVersion?: string;
}

/**
 * Filter articles by date range and write to a temp file.
 * Returns the temp path, or null if no filtering needed.
 */
function filterByDate(absPath: string, dateFrom?: string, dateTo?: string): string | null {
  if (!dateFrom && !dateTo) return null;

  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const data = JSON.parse(raw);
    const articles: Array<{ date?: string }> = Array.isArray(data) ? data : (data.articles || []);

    const filtered = articles.filter((a) => {
      if (!a.date) return true; // keep articles without dates
      const d = a.date.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });

    if (filtered.length === articles.length) return null; // no filtering needed

    const tmpPath = path.join(os.tmpdir(), `enrich_filtered_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    const output = Array.isArray(data) ? filtered : { ...data, articles: filtered };
    fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf-8');
    return tmpPath;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: EnrichRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { files, model, provider, dateFrom, dateTo, promptVersion } = body;

  if (!Array.isArray(files) || files.length === 0) {
    return new Response(
      JSON.stringify({ error: 'At least one file is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const cwd = process.cwd();
  const encoder = new TextEncoder();
  const tmpFiles: string[] = [];

  // Initialize process store
  markStarted('enrich', { files: files.map((f) => f.path), model, dateFrom, dateTo }, {
    fileCount: files.length,
    currentFileIndex: 0,
    currentFileName: '',
  });

  const stream = new ReadableStream({
    start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        // Persist to disk for reconnection
        appendLog('enrich', {
          ts: Date.now(),
          text: (data.text as string) || '',
          fileIndex: data.fileIndex as number | undefined,
          isError: !!data.error,
          isDone: data.type === 'file_done' || data.type === 'done',
          isFileHeader: data.type === 'file_start',
          type: data.type as string,
          exitCode: data.exitCode as number | undefined,
        });
      }

      send({ type: 'start', fileCount: files.length, model: model || '(from prompt config)' });

      let fileIndex = 0;

      function processNext() {
        if (fileIndex >= files.length) {
          // Clean up temp files
          for (const tmp of tmpFiles) {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          }
          send({ type: 'done' });
          markDone('enrich');
          controller.close();
          return;
        }

        const file = files[fileIndex];
        const inputPath = file.absolutePath;
        const idx = fileIndex;

        // Build output path: same location with _enriched suffix
        const parsed = path.parse(inputPath);
        const outputPath = path.join(parsed.dir, `${parsed.name}_enriched${parsed.ext}`);

        send({
          type: 'file_start',
          fileIndex: idx,
          fileName: file.path,
          text: `Starting enrichment: ${file.path}`,
        });
        updateProcessFields('enrich', { currentFileIndex: idx, currentFileName: file.path });

        // Apply date filtering if needed
        const filteredPath = filterByDate(inputPath, dateFrom, dateTo);
        const actualInput = filteredPath || inputPath;
        if (filteredPath) {
          tmpFiles.push(filteredPath);
          send({ type: 'log', fileIndex: idx, text: `Date filter applied (${dateFrom || '*'} → ${dateTo || '*'})` });
        }

        // Build command args — uses async_enricher (turbo) with 30 concurrent LLM calls
        // Run as module (-m) to support relative imports
        const args = [
          '-m', 'scripts.pipeline.async_enricher',
          '--input', actualInput,
          '--output', outputPath,
          '--concurrency', String(CONCURRENCY),
        ];
        if (model) args.push('--model', model);
        if (provider) args.push('--provider', provider);
        if (promptVersion) args.push('--prompt-version', promptVersion);

        let child: ReturnType<typeof spawn>;
        try {
          child = spawn('python3', args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });
          if (child.pid) addPid('enrich', child.pid);
        } catch (err) {
          send({ type: 'log', fileIndex: idx, text: `Failed to spawn: ${err}`, error: true });
          fileIndex++;
          processNext();
          return;
        }

        child.stdout!.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            send({ type: 'log', fileIndex: idx, text: line });
          }
        });

        child.stderr!.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            send({ type: 'log', fileIndex: idx, text: line, error: true });
          }
        });

        child.on('error', (err) => {
          send({ type: 'log', fileIndex: idx, text: `Process error: ${err.message}`, error: true });
        });

        child.on('close', (code) => {
          send({
            type: 'file_done',
            fileIndex: idx,
            exitCode: code,
            text: code === 0
              ? `Finished: ${file.path} → ${path.basename(outputPath)}`
              : `Failed with exit code ${code}: ${file.path}`,
          });
          fileIndex++;
          processNext();
        });
      }

      processNext();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
