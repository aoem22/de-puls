import fs from 'fs';
import path from 'path';
import { parseChunkFilename } from './chunk-utils';
import { listFilesRecursive } from './fs-walk';

const DATA_DIR = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_RAW_DIR = path.join(DATA_DIR, 'chunks', 'raw');
const CHUNKS_ENRICHED_DIR = path.join(DATA_DIR, 'chunks', 'enriched');

interface FileCandidate {
  key: string;
  bundesland: string;
  yearMonth: string;
  absPath: string;
  mtimeMs: number;
}

export interface LocalCounts {
  raw: number;
  enriched: number;
  geocoded: number;
}

export interface LocalPipelineStats {
  totalScraped: number;
  totalEnriched: number;
  totalGeocoded: number;
  byMonth: Record<string, LocalCounts>;
  byBundesland: Record<string, LocalCounts>;
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

function articleMonth(article: { date?: unknown }): string | null {
  if (typeof article.date !== 'string') return null;
  const ym = article.date.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? ym : null;
}

function parseArticles(absPath: string): Array<{ date?: string; location?: { lat?: number; lon?: number } }> {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.articles || []);
  } catch {
    return [];
  }
}

function dedupeCandidates(candidates: FileCandidate[]): FileCandidate[] {
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out: FileCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    out.push(candidate);
  }

  return out;
}

function collectRawCandidates(): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  if (!fs.existsSync(CHUNKS_RAW_DIR)) return candidates;

  for (const entry of listFilesRecursive(CHUNKS_RAW_DIR)) {
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.meta.json')) continue;
    if (entry.name.includes('_enriched') || entry.name.includes('_removed')) continue;

    let bundesland = '';
    let yearMonth = '';

    const nested = entry.relPath.match(/^([^/]+)\/(\d{4})\/(\d{2})\.json$/);
    if (nested) {
      const [, bl, year, month] = nested;
      bundesland = bl;
      yearMonth = `${year}-${month}`;
    } else {
      const parsed = parseChunkFilename(entry.name);
      if (!parsed) continue;
      bundesland = parsed.bundesland;
      yearMonth = parsed.yearMonth;
    }

    const key = `${bundesland}:${yearMonth}`;
    const stat = fs.statSync(entry.absPath);
    candidates.push({ key, bundesland, yearMonth, absPath: entry.absPath, mtimeMs: stat.mtimeMs });
  }

  return dedupeCandidates(candidates);
}

function collectEnrichedCandidates(): FileCandidate[] {
  const candidates: FileCandidate[] = [];

  if (fs.existsSync(CHUNKS_ENRICHED_DIR)) {
    for (const entry of listFilesRecursive(CHUNKS_ENRICHED_DIR)) {
      if (!entry.name.endsWith('.json')) continue;

      const nested = entry.relPath.match(/^([^/]+)\/(\d{4})\/(\d{2})\.json$/);
      if (!nested) continue;

      const [, bl, year, month] = nested;
      const yearMonth = `${year}-${month}`;
      const key = `${bl}:${yearMonth}`;
      const stat = fs.statSync(entry.absPath);
      candidates.push({ key, bundesland: bl, yearMonth, absPath: entry.absPath, mtimeMs: stat.mtimeMs });
    }
  }

  if (fs.existsSync(CHUNKS_RAW_DIR)) {
    for (const entry of listFilesRecursive(CHUNKS_RAW_DIR)) {
      if (!entry.name.endsWith('_enriched.json')) continue;
      if (entry.name.includes('_removed')) continue;

      let bundesland = '';
      let yearMonth = '';

      const nested = entry.relPath.match(/^([^/]+)\/(\d{4})\/(\d{2})_enriched\.json$/);
      if (nested) {
        const [, bl, year, month] = nested;
        bundesland = bl;
        yearMonth = `${year}-${month}`;
      } else {
        const parsed = parseChunkFilename(entry.name.replace('_enriched', ''));
        if (!parsed) continue;
        bundesland = parsed.bundesland;
        yearMonth = parsed.yearMonth;
      }

      const key = `${bundesland}:${yearMonth}`;
      const stat = fs.statSync(entry.absPath);
      candidates.push({ key, bundesland, yearMonth, absPath: entry.absPath, mtimeMs: stat.mtimeMs });
    }
  }

  return dedupeCandidates(candidates);
}

function ensureBucket(map: Record<string, LocalCounts>, key: string): LocalCounts {
  if (!map[key]) {
    map[key] = { raw: 0, enriched: 0, geocoded: 0 };
  }
  return map[key];
}

function addMonthlyFallback(months: Record<string, LocalCounts>, yearMonth: string, kind: 'raw' | 'enriched' | 'geocoded', value: number): void {
  if (!yearMonth || value === 0) return;
  const bucket = ensureBucket(months, yearMonth);
  bucket[kind] += value;
}

export function collectLocalPipelineStats(): LocalPipelineStats {
  const byMonth: Record<string, LocalCounts> = {};
  const byBundesland: Record<string, LocalCounts> = {};

  let totalScraped = 0;
  let totalEnriched = 0;
  let totalGeocoded = 0;

  const rawFiles = collectRawCandidates();
  for (const file of rawFiles) {
    const articles = parseArticles(file.absPath);
    const fileTotal = articles.length;
    totalScraped += fileTotal;

    const blBucket = ensureBucket(byBundesland, file.bundesland);
    blBucket.raw += fileTotal;

    const monthCounts: Record<string, number> = {};
    for (const article of articles) {
      const ym = articleMonth(article);
      if (!ym) continue;
      monthCounts[ym] = (monthCounts[ym] || 0) + 1;
    }

    if (Object.keys(monthCounts).length === 0) {
      addMonthlyFallback(byMonth, file.yearMonth, 'raw', fileTotal);
    } else {
      for (const [ym, count] of Object.entries(monthCounts)) {
        const monthBucket = ensureBucket(byMonth, ym);
        monthBucket.raw += count;
      }
    }
  }

  const enrichedFiles = collectEnrichedCandidates();
  for (const file of enrichedFiles) {
    const articles = parseArticles(file.absPath);

    let fileGeocoded = 0;
    for (const article of articles) {
      if (hasCoords(article.location)) fileGeocoded += 1;
    }

    totalEnriched += articles.length;
    totalGeocoded += fileGeocoded;

    const blBucket = ensureBucket(byBundesland, file.bundesland);
    blBucket.enriched += articles.length;
    blBucket.geocoded += fileGeocoded;

    const monthCounts: Record<string, { enriched: number; geocoded: number }> = {};
    for (const article of articles) {
      const ym = articleMonth(article);
      if (!ym) continue;
      if (!monthCounts[ym]) monthCounts[ym] = { enriched: 0, geocoded: 0 };
      monthCounts[ym].enriched += 1;
      if (hasCoords(article.location)) monthCounts[ym].geocoded += 1;
    }

    if (Object.keys(monthCounts).length === 0) {
      addMonthlyFallback(byMonth, file.yearMonth, 'enriched', articles.length);
      addMonthlyFallback(byMonth, file.yearMonth, 'geocoded', fileGeocoded);
    } else {
      for (const [ym, counts] of Object.entries(monthCounts)) {
        const monthBucket = ensureBucket(byMonth, ym);
        monthBucket.enriched += counts.enriched;
        monthBucket.geocoded += counts.geocoded;
      }
    }
  }

  return {
    totalScraped,
    totalEnriched,
    totalGeocoded,
    byMonth,
    byBundesland,
  };
}
