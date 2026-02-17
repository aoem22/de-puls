#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

interface GeocodeRow {
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: string | null;
  updated_at: string | null;
}

interface Options {
  dryRun: boolean;
  mode: 'both' | 'enriched' | 'raw';
}

function parseOptions(argv: string[]): Options {
  const args = new Set(argv);
  const dryRun = args.has('--dry-run');
  const mode: Options['mode'] = args.has('--enriched-only')
    ? 'enriched'
    : args.has('--raw-only')
      ? 'raw'
      : 'both';

  return { dryRun, mode };
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvIntoProcess(): void {
  const root = process.cwd();
  const fromDotEnv = parseEnvFile(path.join(root, '.env'));
  const fromDotEnvLocal = parseEnvFile(path.join(root, '.env.local'));
  const merged = { ...fromDotEnv, ...fromDotEnvLocal };

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function isValidCoord(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

function collectFilesRecursive(rootDir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && predicate(entry.name)) {
        out.push(abs);
      }
    }
  }

  out.sort();
  return out;
}

function parseArticles(raw: string): { container: unknown; articles: Array<Record<string, unknown>> } {
  const data = JSON.parse(raw);
  const articles = Array.isArray(data)
    ? data
    : (Array.isArray((data as { articles?: unknown }).articles)
      ? ((data as { articles: Array<Record<string, unknown>> }).articles)
      : []);
  return { container: data, articles };
}

async function fetchGeocodeIndex(): Promise<Map<string, { lat: number; lon: number; precision: string | null; updatedAtMs: number }>> {
  loadEnvIntoProcess();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase credentials in .env/.env.local');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const index = new Map<string, { lat: number; lon: number; precision: string | null; updatedAtMs: number }>();
  const PAGE_SIZE = 1000;

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('crime_records')
      .select('source_url, latitude, longitude, precision, updated_at')
      .eq('hidden', false)
      .not('source_url', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    const rows = (data ?? []) as GeocodeRow[];
    for (const row of rows) {
      if (!row.source_url) continue;
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (!isValidCoord(lat, lon)) continue;

      // Ordered by updated_at desc, so first seen row per URL is newest.
      if (!index.has(row.source_url)) {
        const updatedAtMs = row.updated_at ? Date.parse(row.updated_at) : 0;
        index.set(row.source_url, {
          lat,
          lon,
          precision: row.precision ?? null,
          updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return index;
}

function shouldReplaceCoords(location: Record<string, unknown>): boolean {
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  return !isValidCoord(lat, lon);
}

function maybeUpdatePrecision(location: Record<string, unknown>, incoming: string | null): void {
  const current = typeof location.precision === 'string'
    ? location.precision.trim().toLowerCase()
    : '';

  if (!current || current === 'none' || current === 'unknown') {
    location.precision = incoming || 'city';
  }
}

function syncFile(absPath: string, geocodeByUrl: Map<string, { lat: number; lon: number; precision: string | null }>, dryRun: boolean): {
  changed: boolean;
  updatedArticles: number;
  matchedUrls: number;
  articles: number;
} {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const { container, articles } = parseArticles(raw);

  let updatedArticles = 0;
  let matchedUrls = 0;

  for (const article of articles) {
    const url = typeof article.url === 'string' ? article.url : '';
    if (!url) continue;
    const match = geocodeByUrl.get(url);
    if (!match) continue;
    matchedUrls += 1;

    const locationValue = article.location;
    const location = (locationValue && typeof locationValue === 'object')
      ? (locationValue as Record<string, unknown>)
      : {};

    if (shouldReplaceCoords(location)) {
      location.lat = match.lat;
      location.lon = match.lon;
      maybeUpdatePrecision(location, match.precision);
      article.location = location;
      updatedArticles += 1;
    }
  }

  const changed = updatedArticles > 0;
  if (changed && !dryRun) {
    const output = Array.isArray(container)
      ? articles
      : { ...(container as Record<string, unknown>), articles };
    fs.writeFileSync(absPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  }

  return {
    changed,
    updatedArticles,
    matchedUrls,
    articles: articles.length,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dataRoot = path.join(process.cwd(), 'data', 'pipeline', 'chunks');
  const enrichedRoot = path.join(dataRoot, 'enriched');
  const rawRoot = path.join(dataRoot, 'raw');

  const geocodeByUrl = await fetchGeocodeIndex();

  const targets: string[] = [];
  if (options.mode === 'both' || options.mode === 'enriched') {
    targets.push(...collectFilesRecursive(enrichedRoot, (name) => name.endsWith('.json')));
  }
  if (options.mode === 'both' || options.mode === 'raw') {
    targets.push(...collectFilesRecursive(rawRoot, (name) => name.endsWith('_enriched.json')));
  }

  let filesScanned = 0;
  let filesChanged = 0;
  let articlesScanned = 0;
  let matchedUrls = 0;
  let updatedArticles = 0;

  for (const file of targets) {
    filesScanned += 1;
    const result = syncFile(file, geocodeByUrl, options.dryRun);
    articlesScanned += result.articles;
    matchedUrls += result.matchedUrls;
    updatedArticles += result.updatedArticles;
    if (result.changed) filesChanged += 1;
  }

  const summary = {
    dryRun: options.dryRun,
    mode: options.mode,
    supabaseUniqueUrls: geocodeByUrl.size,
    filesScanned,
    filesChanged,
    articlesScanned,
    matchedUrls,
    updatedArticles,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err instanceof Error ? err.message : err)}\n`);
  process.exit(1);
});

