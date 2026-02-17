import { NextResponse } from 'next/server';
import fs, { createReadStream } from 'fs';
import path from 'path';
import { parseChunkFilename } from '@/lib/admin/chunk-utils';

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_ENRICHED = path.join(DATA_ROOT, 'chunks', 'enriched');
const CHUNKS_RAW = path.join(DATA_ROOT, 'chunks', 'raw');
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50 MB

interface EnrichHistoryFile {
  bundesland: string;
  yearMonth: string;
  filename: string;
  path: string;
  articleCount: number;
  rawArticleCount: number | null;
  dateRange: { start: string | null; end: string | null };
  sizeBytes: number;
  createdAt: string;
}

interface ScanResult {
  file: EnrichHistoryFile;
  dayCounts: Record<string, number>;
}

/** Count array length in a JSON file by streaming (for large files) */
async function countArticlesStreaming(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let depth = 0;
    let count = 0;
    let inString = false;
    let escaped = false;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    stream.on('data', (chunk) => {
      for (const ch of chunk) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '[' || ch === '{') {
          depth++;
          if (ch === '{' && depth === 2) count++;
        } else if (ch === ']' || ch === '}') {
          depth--;
        }
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', () => resolve(0));
  });
}

function extractDateRangeFromFilename(filename: string): { start: string | null; end: string | null } {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})[_.](\d{4}-\d{2}-\d{2})/);
  if (match) return { start: match[1], end: match[2] };
  return { start: null, end: null };
}

/** Parse articles from a JSON file (array or {articles: [...]}) */
function parseArticles(raw: string): Array<{ date?: string }> {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.articles || []);
}

/** Count articles in the matching raw chunk for completeness calculation */
function countRawArticles(bundesland: string, year: string, month: string): number | null {
  const rawPath = path.join(CHUNKS_RAW, bundesland, year, `${month}.json`);
  try {
    if (!fs.existsSync(rawPath)) return null;
    const stats = fs.statSync(rawPath);
    if (!stats.isFile() || stats.size < 3) return null;
    const raw = fs.readFileSync(rawPath, 'utf-8');
    return parseArticles(raw).length;
  } catch {
    return null;
  }
}

async function scanFile(
  absPath: string,
  bundesland: string,
  yearMonth: string,
  filename: string,
  relPath: string,
  rawArticleCount: number | null,
): Promise<ScanResult | null> {
  try {
    const stats = fs.statSync(absPath);
    if (!stats.isFile() || stats.size < 3) return null;

    let articleCount = 0;
    let dateRange: { start: string | null; end: string | null } = { start: null, end: null };
    const dayCounts: Record<string, number> = {};

    if (stats.size > LARGE_FILE_THRESHOLD) {
      articleCount = await countArticlesStreaming(absPath);
      const rangeFromName = extractDateRangeFromFilename(filename);
      if (rangeFromName.start && rangeFromName.end) {
        dateRange = rangeFromName;
        const start = new Date(rangeFromName.start);
        const end = new Date(rangeFromName.end);
        const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        const perDay = Math.round(articleCount / totalDays);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          dayCounts[d.toISOString().slice(0, 10)] = perDay;
        }
      }
    } else {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const articles = parseArticles(raw);
      articleCount = articles.length;

      for (const a of articles) {
        if (!a.date) continue;
        const d = a.date.slice(0, 10);
        if (!dateRange.start || d < dateRange.start) dateRange.start = d;
        if (!dateRange.end || d > dateRange.end) dateRange.end = d;
        dayCounts[d] = (dayCounts[d] || 0) + 1;
      }
    }

    return {
      file: {
        bundesland,
        yearMonth,
        filename,
        path: relPath,
        articleCount,
        rawArticleCount,
        dateRange,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
      },
      dayCounts,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const results: ScanResult[] = [];
  const tasks: Promise<void>[] = [];

  // 1. Scan chunks/enriched/ — supports nested {bundesland}/{year}/{MM}.json
  if (fs.existsSync(CHUNKS_ENRICHED)) {
    for (const blDir of fs.readdirSync(CHUNKS_ENRICHED)) {
      const blPath = path.join(CHUNKS_ENRICHED, blDir);
      if (!fs.statSync(blPath).isDirectory()) continue;

      for (const yearDir of fs.readdirSync(blPath)) {
        const yearPath = path.join(blPath, yearDir);
        if (!fs.statSync(yearPath).isDirectory()) continue;

        for (const file of fs.readdirSync(yearPath)) {
          if (!file.endsWith('.json')) continue;
          const absPath = path.join(yearPath, file);
          const month = file.slice(0, -5); // "01" from "01.json"
          const yearMonth = `${yearDir}-${month}`;
          const displayName = `${blDir}/${yearDir}/${file}`;
          const relPath = `chunks/enriched/${displayName}`;
          const rawCount = countRawArticles(blDir, yearDir, month);
          tasks.push(
            scanFile(absPath, blDir, yearMonth, displayName, relPath, rawCount)
              .then((r) => { if (r) results.push(r); })
          );
        }
      }
    }
  }

  // 2. Scan chunks/raw/*_enriched*.json (admin enricher output)
  if (fs.existsSync(CHUNKS_RAW)) {
    for (const file of fs.readdirSync(CHUNKS_RAW)) {
      if (!file.endsWith('.json') || !file.includes('_enriched')) continue;
      const absPath = path.join(CHUNKS_RAW, file);
      try { if (!fs.statSync(absPath).isFile()) continue; } catch { continue; }
      // Strip _enriched to parse bundesland from base filename
      const baseName = file.replace('_enriched', '');
      const parsed = parseChunkFilename(baseName);
      const bl = parsed?.bundesland ?? 'unknown';
      tasks.push(
        scanFile(absPath, bl, '', file, `chunks/raw/${file}`, null)
          .then((r) => { if (r) results.push(r); })
      );
    }
  }

  await Promise.all(tasks);

  // Sort newest first so freshest file wins per state+day dedup
  results.sort((a, b) =>
    new Date(b.file.createdAt).getTime() - new Date(a.file.createdAt).getTime()
  );

  // Merge day counts with dedup: skip if we already counted this bundesland+day
  const byDay: Record<string, number> = {};
  const byBundesland: Record<string, Record<string, number>> = {};
  const seenStateDay = new Set<string>();
  for (const r of results) {
    const bl = r.file.bundesland;
    if (!byBundesland[bl]) byBundesland[bl] = {};
    for (const [day, count] of Object.entries(r.dayCounts)) {
      const key = `${bl}:${day}`;
      if (seenStateDay.has(key)) continue;
      seenStateDay.add(key);
      byDay[day] = (byDay[day] || 0) + count;
      byBundesland[bl][day] = (byBundesland[bl][day] || 0) + count;
    }
  }

  const files = results
    .map((r) => r.file)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ files, byDay, byBundesland });
}
