import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  markStarted,
  addPid,
  appendLog,
  updateProcessFields,
  markDone,
} from '@/lib/admin/process-store';

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');
const CACHE_FILE = path.join(process.cwd(), '.cache', 'here_geocode_cache.json');

interface GeocodeRequest {
  files: Array<{ path: string }>;
  maxRps?: number;
  force?: boolean;
}

function isAllowedPipelinePath(filePath: string): boolean {
  if (filePath.includes('..')) return false;
  return filePath.startsWith('chunks/enriched/') || filePath.startsWith('chunks/raw/');
}

function resolveInputPath(filePath: string): string | null {
  if (!isAllowedPipelinePath(filePath)) return null;
  const abs = path.resolve(DATA_ROOT, filePath);
  if (!abs.startsWith(DATA_ROOT)) return null;
  return abs;
}

export async function POST(request: NextRequest) {
  let body: GeocodeRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const files = Array.isArray(body.files) ? body.files : [];
  const maxRps = Number.isFinite(body.maxRps) ? Math.max(0.1, Number(body.maxRps)) : 5;
  const force = !!body.force;

  if (files.length === 0) {
    return new Response(
      JSON.stringify({ error: 'At least one file is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();

  markStarted('geocode', {
    files: files.map((f) => f.path),
    maxRps,
    force,
  }, {
    fileCount: files.length,
    currentFileIndex: 0,
    currentFileName: '',
  });

  const stream = new ReadableStream({
    start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        appendLog('geocode', {
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

      send({
        type: 'start',
        fileCount: files.length,
        text: `Starting geocoding on ${files.length} file(s) at max ${maxRps} req/s`,
      });

      let fileIndex = 0;

      function processNext() {
        if (fileIndex >= files.length) {
          send({ type: 'done', text: 'All files geocoded.' });
          markDone('geocode');
          controller.close();
          return;
        }

        const file = files[fileIndex];
        const idx = fileIndex;

        const absPath = resolveInputPath(file.path);
        if (!absPath) {
          send({
            type: 'file_done',
            fileIndex: idx,
            exitCode: 1,
            error: true,
            text: `Invalid file path: ${file.path}`,
          });
          fileIndex++;
          processNext();
          return;
        }

        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
          send({
            type: 'file_done',
            fileIndex: idx,
            exitCode: 1,
            error: true,
            text: `File not found: ${file.path}`,
          });
          fileIndex++;
          processNext();
          return;
        }

        send({
          type: 'file_start',
          fileIndex: idx,
          fileName: file.path,
          text: `Starting geocoding: ${file.path}`,
        });
        updateProcessFields('geocode', { currentFileIndex: idx, currentFileName: file.path });

        const args = [
          '-m', 'scripts.pipeline.geocodify_geocoder',
          '--input', absPath,
          '--output', absPath,
          '--cache-file', CACHE_FILE,
          '--max-rps', String(maxRps),
        ];
        if (force) args.push('--force');

        let child: ReturnType<typeof spawn>;
        try {
          child = spawn('python3', args, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });
          if (child.pid) addPid('geocode', child.pid);
        } catch (err) {
          send({
            type: 'log',
            fileIndex: idx,
            error: true,
            text: `Failed to spawn geocoder: ${String(err)}`,
          });
          fileIndex++;
          processNext();
          return;
        }

        child.stdout?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            send({ type: 'log', fileIndex: idx, text: line });
          }
        });

        child.stderr?.on('data', (chunk: Buffer) => {
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
              ? `Finished geocoding: ${file.path}`
              : `Geocoding failed with exit code ${code}: ${file.path}`,
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
