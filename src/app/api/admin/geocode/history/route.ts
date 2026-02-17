import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parseChunkFilename } from '@/lib/admin/chunk-utils';
import { listFilesRecursive } from '@/lib/admin/fs-walk';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_ENRICHED = path.join(DATA_ROOT, 'chunks', 'enriched');
const CHUNKS_RAW = path.join(DATA_ROOT, 'chunks', 'raw');

interface GeocodePoint {
  lat: number;
  lon: number;
  bundesland: string;
}

interface GeocodeHistoryFile {
  bundesland: string;
  yearMonth: string;
  filename: string;
  path: string;
  articleCount: number;
  geocodedCount: number;
  dateRange: { start: string | null; end: string | null };
  sizeBytes: number;
  createdAt: string;
}

interface ScanResult {
  file: GeocodeHistoryFile;
  dayCounts: Record<string, number>;
  dayPoints: Record<string, GeocodePoint[]>;
}

function dedupeKey(file: GeocodeHistoryFile): string {
  if (file.yearMonth) return `${file.bundesland}:${file.yearMonth}`;
  return `path:${file.path}`;
}

function parseArticles(raw: string): Array<{ date?: string; location?: { lat?: number; lon?: number } }> {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.articles || []);
}

function hasCoords(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const loc = value as { lat?: unknown; lon?: unknown };
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // Legacy placeholder used for unresolved geocodes.
  if (lat === 0 && lon === 0) return false;
  return true;
}

function scanFile(
  absPath: string,
  bundesland: string,
  yearMonth: string,
  filename: string,
  relPath: string,
): ScanResult | null {
  try {
    const stats = fs.statSync(absPath);
    if (!stats.isFile() || stats.size < 3) return null;

    const raw = fs.readFileSync(absPath, 'utf-8');
    const articles = parseArticles(raw);

    let articleCount = 0;
    let geocodedCount = 0;
    const dayCounts: Record<string, number> = {};
    const dayPoints: Record<string, GeocodePoint[]> = {};
    let start: string | null = null;
    let end: string | null = null;

    for (const article of articles) {
      articleCount += 1;
      const date = typeof article.date === 'string' ? article.date.slice(0, 10) : null;
      if (date) {
        if (!start || date < start) start = date;
        if (!end || date > end) end = date;
      }

      if (!hasCoords(article.location)) continue;
      geocodedCount += 1;
      if (date) {
        dayCounts[date] = (dayCounts[date] || 0) + 1;
        const loc = article.location as { lat?: number; lon?: number };
        const lat = Number(loc.lat);
        const lon = Number(loc.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          if (!dayPoints[date]) dayPoints[date] = [];
          dayPoints[date].push({ lat, lon, bundesland });
        }
      }
    }

    return {
      file: {
        bundesland,
        yearMonth,
        filename,
        path: relPath,
        articleCount,
        geocodedCount,
        dateRange: { start, end },
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
      },
      dayCounts,
      dayPoints,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const results: ScanResult[] = [];

  // 1) chunks/enriched/{bundesland}/{year}/{MM}.json
  if (fs.existsSync(CHUNKS_ENRICHED)) {
    for (const blDir of fs.readdirSync(CHUNKS_ENRICHED)) {
      const blPath = path.join(CHUNKS_ENRICHED, blDir);
      if (!fs.statSync(blPath).isDirectory()) continue;

      for (const yearDir of fs.readdirSync(blPath)) {
        const yearPath = path.join(blPath, yearDir);
        if (!fs.statSync(yearPath).isDirectory()) continue;

        for (const file of fs.readdirSync(yearPath)) {
          if (!file.endsWith('.json')) continue;
          const month = file.replace('.json', '');
          if (!/^\d{2}$/.test(month)) continue;

          const rel = `chunks/enriched/${blDir}/${yearDir}/${file}`;
          const abs = path.join(yearPath, file);
          const scanned = scanFile(abs, blDir, `${yearDir}-${month}`, `${blDir}/${yearDir}/${file}`, rel);
          if (scanned) results.push(scanned);
        }
      }
    }
  }

  // 2) chunks/raw/**/*_enriched.json (admin enricher output)
  if (fs.existsSync(CHUNKS_RAW)) {
    for (const entry of listFilesRecursive(CHUNKS_RAW)) {
      if (!entry.name.endsWith('_enriched.json')) continue;

      let bundesland = 'unknown';
      let yearMonth = '';

      const nested = entry.relPath.match(/^([^/]+)\/(\d{4})\/(\d{2})_enriched\.json$/);
      if (nested) {
        const [, bl, year, month] = nested;
        bundesland = bl;
        yearMonth = `${year}-${month}`;
      } else {
        const parsed = parseChunkFilename(entry.name.replace('_enriched', ''));
        if (parsed) {
          bundesland = parsed.bundesland;
          yearMonth = parsed.yearMonth;
        }
      }

      const rel = `chunks/raw/${entry.relPath}`;
      const scanned = scanFile(entry.absPath, bundesland, yearMonth, entry.relPath, rel);
      if (scanned) results.push(scanned);
    }
  }

  // Newest first so duplicates from legacy paths are superseded by fresh files.
  results.sort((a, b) =>
    new Date(b.file.createdAt).getTime() - new Date(a.file.createdAt).getTime(),
  );

  // Deduplicate scan results by bundesland+yearMonth (or path fallback), keeping newest.
  // This keeps all derived views (files list + day aggregations + map points) consistent.
  const dedupedResults: ScanResult[] = [];
  const seenFileKeys = new Set<string>();
  for (const result of results) {
    const key = dedupeKey(result.file);
    if (seenFileKeys.has(key)) continue;
    seenFileKeys.add(key);
    dedupedResults.push(result);
  }

  const byDay: Record<string, number> = {};
  const byBundesland: Record<string, Record<string, number>> = {};
  const pointsByDay: Record<string, GeocodePoint[]> = {};

  for (const result of dedupedResults) {
    const bl = result.file.bundesland;
    if (!byBundesland[bl]) byBundesland[bl] = {};

    for (const [day, count] of Object.entries(result.dayCounts)) {
      byDay[day] = (byDay[day] || 0) + count;
      byBundesland[bl][day] = (byBundesland[bl][day] || 0) + count;
      if (!pointsByDay[day]) pointsByDay[day] = [];
      const points = result.dayPoints[day] || [];
      pointsByDay[day].push(...points);
    }
  }

  const files = dedupedResults
    .map((result) => result.file)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  return NextResponse.json(
    { files, byDay, byBundesland, pointsByDay },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
