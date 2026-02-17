import { NextRequest } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { markStarted, addPid, appendLog, updateProcessFields, markDone } from '@/lib/admin/process-store';

/** States with dedicated scrapers (not presseportal) */
const DEDICATED_STATES = new Set([
  'berlin',
  'brandenburg',
  'bayern',
  'sachsen-anhalt',
  'sachsen',
]);

/** Dedicated scraper script paths (relative to project root) */
const DEDICATED_SCRIPTS: Record<string, string> = {
  'berlin': 'scripts/scrapers/scrape_berlin_polizei.py',
  'brandenburg': 'scripts/scrapers/scrape_brandenburg_polizei.py',
  'bayern': 'scripts/scrapers/scrape_bayern_polizei.py',
  'sachsen-anhalt': 'scripts/scrapers/scrape_sachsen_anhalt.py',
  'sachsen': 'scripts/scrapers/scrape_sachsen_polizei.py',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Presseportal caps pagination at 300 pages × 30 articles = 9,000 articles.
 * Ranges spanning >1 month are auto-chunked into monthly sub-ranges to stay
 * under the limit. All month chunks for a state run concurrently.
 */
interface DateChunk {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // e.g. "2025-03"
}

/** Split a date range into monthly chunks */
function splitIntoMonths(startDate: string, endDate: string): DateChunk[] {
  const chunks: DateChunk[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  // If range fits in a single month, no chunking needed
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return [{ start: startDate, end: endDate, label: startDate.slice(0, 7) }];
  }

  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkStart = new Date(cursor);

    // End of this month
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const chunkEnd = monthEnd > end ? end : monthEnd;

    const cs = fmt(chunkStart);
    const ce = fmt(chunkEnd);
    chunks.push({ start: cs, end: ce, label: cs.slice(0, 7) });

    // Move to first day of next month
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return chunks;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Reorganize a flat scrape output file into the nested monthly structure.
 * Reads `raw/{bl}_{start}_{end}.json`, groups articles by month, and writes
 * each group into `raw/{bl}/{year}/{MM}.json` (merging with existing data).
 * Deletes the flat file (and its .meta.json) after successful reorganization.
 */
function reorganizeIntoMonthly(flatFile: string, bundesland: string, chunksRawDir: string): { months: number; total: number } {
  if (!fs.existsSync(flatFile)) return { months: 0, total: 0 };

  const raw = fs.readFileSync(flatFile, 'utf-8');
  const data = JSON.parse(raw);
  const articles: Array<Record<string, unknown>> = Array.isArray(data) ? data : (data.articles || []);

  if (articles.length === 0) return { months: 0, total: 0 };

  // Group articles by YYYY-MM
  const byMonth: Record<string, Array<Record<string, unknown>>> = {};
  for (const a of articles) {
    const date = a.date as string | undefined;
    if (!date || date.length < 7) continue;
    const ym = date.slice(0, 7); // "2026-01"
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(a);
  }

  let total = 0;
  for (const [ym, monthArticles] of Object.entries(byMonth)) {
    const [year, month] = ym.split('-');
    const monthDir = path.join(chunksRawDir, bundesland, year);
    const monthFile = path.join(monthDir, `${month}.json`);

    // Merge with existing data if present
    const seen = new Set<string>();
    const merged: unknown[] = [];

    if (fs.existsSync(monthFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(monthFile, 'utf-8'));
        const existingArticles = Array.isArray(existing) ? existing : (existing.articles || []);
        for (const ea of existingArticles) {
          const url = (ea as Record<string, unknown>).url as string;
          if (url && !seen.has(url)) {
            seen.add(url);
            merged.push(ea);
          }
        }
      } catch { /* ignore corrupt existing */ }
    }

    for (const a of monthArticles) {
      const url = a.url as string;
      if (url && !seen.has(url)) {
        seen.add(url);
        merged.push(a);
      }
    }

    fs.mkdirSync(monthDir, { recursive: true });
    fs.writeFileSync(monthFile, JSON.stringify(merged, null, 2), 'utf-8');
    total += merged.length;
  }

  // Clean up flat file and its meta
  try { fs.unlinkSync(flatFile); } catch { /* ignore */ }
  const metaFile = flatFile.replace(/\.json$/, '.meta.json');
  try { if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile); } catch { /* ignore */ }

  return { months: Object.keys(byMonth).length, total };
}

/** Merge multiple JSON article files into one, deduplicating by URL */
function mergeChunkFiles(chunkFiles: string[], outputFile: string): number {
  const seen = new Set<string>();
  const merged: unknown[] = [];

  // Load existing output file first (preserve prior data)
  if (fs.existsSync(outputFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
      const articles = Array.isArray(existing) ? existing : (existing.articles || []);
      for (const a of articles) {
        const url = (a as Record<string, unknown>).url as string;
        if (url && !seen.has(url)) {
          seen.add(url);
          merged.push(a);
        }
      }
    } catch { /* ignore corrupt existing file */ }
  }

  // Merge chunk files
  for (const file of chunkFiles) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const articles = Array.isArray(data) ? data : (data.articles || []);
      for (const a of articles) {
        const url = (a as Record<string, unknown>).url as string;
        if (url && !seen.has(url)) {
          seen.add(url);
          merged.push(a);
        }
      }
    } catch { /* skip corrupt chunk */ }
  }

  // Write merged output
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2), 'utf-8');

  // Merge companion .meta.json files
  const metaFiles = chunkFiles
    .map((f) => f.replace(/\.json$/, '.meta.json'))
    .filter((f) => fs.existsSync(f));
  if (metaFiles.length > 0) {
    const combined: Record<string, unknown> = {
      source: '',
      pages_visited: 0,
      pages_with_content: 0,
      articles_per_page: null as number | null,
      source_total: null as number | null,
      estimated_total: null as number | null,
      articles_scraped: 0,
      articles_cached_skip: 0,
      articles_feuerwehr_skip: 0,
      stop_reason: [] as string[],
      fetch_count: 0,
      fetch_errors: 0,
      scrape_duration_s: 0,
    };
    for (const mf of metaFiles) {
      try {
        const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
        if (m.source) combined.source = m.source;
        if (m.articles_per_page != null) combined.articles_per_page = m.articles_per_page;
        combined.pages_visited = (combined.pages_visited as number) + (m.pages_visited || 0);
        combined.pages_with_content = (combined.pages_with_content as number) + (m.pages_with_content || 0);
        combined.articles_scraped = (combined.articles_scraped as number) + (m.articles_scraped || 0);
        combined.articles_cached_skip = (combined.articles_cached_skip as number) + (m.articles_cached_skip || 0);
        combined.articles_feuerwehr_skip = (combined.articles_feuerwehr_skip as number) + (m.articles_feuerwehr_skip || 0);
        combined.fetch_count = (combined.fetch_count as number) + (m.fetch_count || 0);
        combined.fetch_errors = (combined.fetch_errors as number) + (m.fetch_errors || 0);
        combined.scrape_duration_s = (combined.scrape_duration_s as number) + (m.scrape_duration_s || 0);
        if (m.source_total != null) {
          combined.source_total = ((combined.source_total as number) || 0) + m.source_total;
        }
        if (m.estimated_total != null) {
          combined.estimated_total = ((combined.estimated_total as number) || 0) + m.estimated_total;
        }
        if (m.stop_reason) {
          (combined.stop_reason as string[]).push(
            ...(Array.isArray(m.stop_reason) ? m.stop_reason : [m.stop_reason])
          );
        }
      } catch { /* skip corrupt meta */ }
    }
    combined.scrape_duration_s = Math.round((combined.scrape_duration_s as number) * 10) / 10;
    const metaOut = outputFile.replace(/\.json$/, '.meta.json');
    fs.writeFileSync(metaOut, JSON.stringify(combined, null, 2), 'utf-8');
    for (const mf of metaFiles) {
      try { fs.unlinkSync(mf); } catch { /* ignore */ }
    }
  }

  // Clean up chunk files
  for (const file of chunkFiles) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }

  return merged.length;
}

export async function POST(request: NextRequest) {
  let body: { bundeslaender: string[]; startDate: string; endDate: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { bundeslaender, startDate, endDate } = body;

  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return new Response(
      JSON.stringify({ error: 'startDate and endDate must be YYYY-MM-DD' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (startDate > endDate) {
    return new Response(
      JSON.stringify({ error: 'startDate must be <= endDate' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!Array.isArray(bundeslaender) || bundeslaender.length === 0) {
    return new Response(
      JSON.stringify({ error: 'At least one Bundesland is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const cwd = process.cwd();
  const scriptPath = path.join(cwd, 'scripts', 'scrape_blaulicht_async.py');
  const encoder = new TextEncoder();

  // Determine chunking strategy
  const chunks = splitIntoMonths(startDate, endDate);
  const needsChunking = chunks.length > 1;

  // Initialize process store
  markStarted('scrape', { bundeslaender, startDate, endDate });

  const stream = new ReadableStream({
    start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        // Persist to disk for reconnection
        appendLog('scrape', {
          ts: Date.now(),
          text: (data.text as string) || '',
          state: data.state as string | undefined,
          isError: !!data.error,
          isDone: data.type === 'state_done' || data.type === 'done',
          type: data.type as string,
          exitCode: data.exitCode as number | undefined,
        });
      }

      send({
        type: 'start',
        states: bundeslaender,
        dateRange: { start: startDate, end: endDate },
        chunks: needsChunking ? chunks.length : 1,
      });

      if (needsChunking) {
        send({
          type: 'log',
          text: `Date range spans ${chunks.length} months — chunking to avoid presseportal 300-page limit`,
        });
      }

      let statesRemaining = bundeslaender.length;
      const doneStatesCollector: string[] = [];

      for (const bl of bundeslaender) {
        const outputDir = path.join(cwd, 'data', 'pipeline', 'chunks', 'raw');
        const finalOutputFile = path.join(outputDir, `${bl}_${startDate}_${endDate}.json`);

        // Helper: handle state completion
        const handleStateDone = (code: number | null, text?: string) => {
          // Reorganize flat file into monthly nested structure
          if (code === 0 && fs.existsSync(finalOutputFile)) {
            try {
              const result = reorganizeIntoMonthly(finalOutputFile, bl, outputDir);
              send({
                type: 'log', state: bl,
                text: `Reorganized ${result.total} articles into ${result.months} monthly file(s)`,
              });
            } catch (err) {
              send({
                type: 'log', state: bl,
                text: `Warning: failed to reorganize into monthly structure: ${err}`,
                error: true,
              });
            }
          }

          send({
            type: 'state_done', state: bl, exitCode: code,
            text: text || (code === 0 ? 'Finished successfully' : `Exited with code ${code}`),
          });
          doneStatesCollector.push(bl);
          updateProcessFields('scrape', { doneStates: [...doneStatesCollector] });
          statesRemaining--;
          if (statesRemaining === 0) { send({ type: 'done' }); markDone('scrape'); controller.close(); }
        };

        if (DEDICATED_STATES.has(bl)) {
          // Dedicated scraper — single process, no chunking needed
          const dedicatedScript = path.join(cwd, DEDICATED_SCRIPTS[bl]);
          send({ type: 'log', state: bl, text: 'Starting dedicated scraper...' });

          const child = spawnDedicatedScraper(
            dedicatedScript, cwd, startDate, endDate, finalOutputFile,
            (line) => send({ type: 'log', state: bl, text: line }),
            (line) => send({ type: 'log', state: bl, text: line, error: true }),
            (code) => handleStateDone(code),
          );
          if (child?.pid) addPid('scrape', child.pid);
        } else if (!needsChunking) {
          // Presseportal — single chunk
          send({ type: 'log', state: bl, text: 'Starting presseportal scraper...' });

          const child = spawnScraper(
            scriptPath, cwd, bl, startDate, endDate, finalOutputFile,
            (line) => send({ type: 'log', state: bl, text: line }),
            (line) => send({ type: 'log', state: bl, text: line, error: true }),
            (code) => handleStateDone(code),
          );
          if (child?.pid) addPid('scrape', child.pid);
        } else {
          // Presseportal — multiple month chunks, run concurrently, merge at end
          const chunkFiles: string[] = [];
          let chunksRemaining = chunks.length;

          send({
            type: 'log', state: bl,
            text: `Launching ${chunks.length} month chunks concurrently...`,
          });

          for (const chunk of chunks) {
            const chunkFile = path.join(outputDir, `.chunk_${bl}_${chunk.start}_${chunk.end}.json`);
            chunkFiles.push(chunkFile);

            const chunkChild = spawnScraper(
              scriptPath, cwd, bl, chunk.start, chunk.end, chunkFile,
              (line) => send({ type: 'log', state: bl, text: `[${chunk.label}] ${line}` }),
              (line) => send({ type: 'log', state: bl, text: `[${chunk.label}] ${line}`, error: true }),
              (code) => {
                if (code !== 0) {
                  send({
                    type: 'log', state: bl,
                    text: `[${chunk.label}] exited with code ${code}`,
                    error: true,
                  });
                } else {
                  send({
                    type: 'log', state: bl,
                    text: `[${chunk.label}] done`,
                  });
                }

                chunksRemaining--;
                if (chunksRemaining === 0) {
                  // All chunks done for this state — merge
                  send({ type: 'log', state: bl, text: 'Merging month chunks...' });
                  try {
                    const totalArticles = mergeChunkFiles(chunkFiles, finalOutputFile);
                    handleStateDone(0, `Merged ${totalArticles} articles into ${path.basename(finalOutputFile)}`);
                  } catch (err) {
                    handleStateDone(1, `Merge failed: ${err}`);
                  }
                }
              }
            );
            if (chunkChild?.pid) addPid('scrape', chunkChild.pid);
          }
        }
      }
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

/** Spawn a single scraper process and wire up stdout/stderr/close handlers */
function spawnScraper(
  scriptPath: string,
  cwd: string,
  bundesland: string,
  startDate: string,
  endDate: string,
  outputFile: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
  onClose: (code: number | null) => void,
): ChildProcess | null {
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  let child: ChildProcess;
  try {
    child = spawn(
      'python3',
      ['-u', scriptPath, '--bundesland', bundesland, '--start-date', startDate, '--end-date', endDate, '--output', outputFile, '--verbose'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    onStderr(`Failed to spawn: ${err}`);
    onClose(1);
    return null;
  }

  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      onStdout(line);
    }
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      onStderr(line);
    }
  });

  child.on('error', (err) => {
    onStderr(`Process error: ${err.message}`);
  });

  child.on('close', onClose);

  return child;
}

/** Spawn a dedicated state scraper (no --bundesland flag, handles its own pagination) */
function spawnDedicatedScraper(
  scriptPath: string,
  cwd: string,
  startDate: string,
  endDate: string,
  outputFile: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
  onClose: (code: number | null) => void,
): ChildProcess | null {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  let child: ChildProcess;
  try {
    child = spawn(
      'python3',
      ['-u', scriptPath, '--start-date', startDate, '--end-date', endDate, '--output', outputFile, '--verbose'],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    onStderr(`Failed to spawn: ${err}`);
    onClose(1);
    return null;
  }

  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      onStdout(line);
    }
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      onStderr(line);
    }
  });

  child.on('error', (err) => {
    onStderr(`Process error: ${err.message}`);
  });

  child.on('close', onClose);

  return child;
}
