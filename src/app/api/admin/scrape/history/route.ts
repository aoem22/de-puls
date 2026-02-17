import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { listFilesRecursive } from '@/lib/admin/fs-walk';

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_RAW = path.join(DATA_ROOT, 'chunks', 'raw');
const COUNTS_FILE = path.join(DATA_ROOT, 'presseportal_counts.json');
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

interface ScrapeMonthRow {
  bundesland: string;
  yearMonth: string;
  filename: string;
  filePath: string;
  articleCount: number;
  presseportalCount: number | null;
  sizeBytes: number;
  modifiedAt: string;
}

/** Stream-count articles (depth-2 objects) for large files */
function countArticlesStreaming(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let depth = 0;
    let count = 0;
    let inString = false;
    let escaped = false;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
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

/** Parse articles from a JSON file (array or {articles: [...]}) */
function parseArticles(raw: string): Array<{ date?: string }> {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.articles || []);
}

/** Load presseportal counts keyed as "hessen/2024-01" → number */
function loadPresseportalCounts(): Record<string, number> {
  try {
    if (!fs.existsSync(COUNTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export async function GET() {
  const ppCounts = loadPresseportalCounts();
  const rows: ScrapeMonthRow[] = [];
  const byDay: Record<string, number> = {};
  const byBundesland: Record<string, Record<string, number>> = {};

  if (!fs.existsSync(CHUNKS_RAW)) {
    return NextResponse.json({ rows: [], byDay: {}, byBundesland: {} });
  }

  const tasks: Promise<void>[] = [];

  // Walk nested structure: {bundesland}/{year}/{month}.json
  for (const entry of listFilesRecursive(CHUNKS_RAW)) {
    if (!entry.name.endsWith('.json') || entry.name.endsWith('.meta.json')) continue;
    const nestedMatch = entry.relPath.match(/^([^/]+)\/(\d{4})\/(\d{2})\.json$/);
    if (!nestedMatch) continue;
    const [, bl, year, month] = nestedMatch;

    const yearMonth = `${year}-${month}`;
    const absPath = entry.absPath;
    const filePath = `chunks/raw/${bl}/${year}/${entry.name}`;
    const ppKey = `${bl}/${yearMonth}`;

    tasks.push(
      (async () => {
        try {
          const stats = fs.statSync(absPath);
          if (!stats.isFile()) return;

          let articleCount = 0;
          const dayCounts: Record<string, number> = {};

          if (stats.size > LARGE_FILE_THRESHOLD) {
            articleCount = await countArticlesStreaming(absPath);
          } else {
            const raw = fs.readFileSync(absPath, 'utf-8');
            const articles = parseArticles(raw);
            articleCount = articles.length;

            for (const a of articles) {
              if (!a.date) continue;
              const d = a.date.slice(0, 10);
              dayCounts[d] = (dayCounts[d] || 0) + 1;
            }
          }

          rows.push({
            bundesland: bl,
            yearMonth,
            filename: `${bl}/${year}/${entry.name}`,
            filePath,
            articleCount,
            presseportalCount: ppCounts[ppKey] ?? null,
            sizeBytes: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          });

          // Accumulate day counts for heatmap
          if (!byBundesland[bl]) byBundesland[bl] = {};
          for (const [day, count] of Object.entries(dayCounts)) {
            byDay[day] = (byDay[day] || 0) + count;
            byBundesland[bl][day] = (byBundesland[bl][day] || 0) + count;
          }
        } catch {
          // skip unreadable files
        }
      })()
    );
  }

  await Promise.all(tasks);

  // Sort rows newest first by modifiedAt
  rows.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  return NextResponse.json({ rows, byDay, byBundesland });
}
