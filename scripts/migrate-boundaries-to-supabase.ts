/**
 * Migration script to upload local boundary GeoJSON files into Supabase.
 *
 * Usage:
 *   npx tsx scripts/migrate-boundaries-to-supabase.ts
 *   npx tsx scripts/migrate-boundaries-to-supabase.ts --dry-run
 *
 * Environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (recommended)
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

type BoundaryLevel = 'country' | 'kreis' | 'city';

interface KreisProps {
  ags?: string;
  name?: string;
  bundesland?: string;
}

interface CityProps {
  ags?: string;
  name?: string;
  state?: string | null;
}

interface CountryProps {
  name?: string;
}

interface GeoBoundaryRow {
  level: BoundaryLevel;
  ags: string;
  name: string;
  bundesland: string | null;
  geometry: Geometry;
  properties: Record<string, unknown>;
  bbox: number[];
  source: string;
  source_dataset: string;
  snapshot: string;
}

function loadEnv(): void {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename);
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function readJson<T>(relativePath: string): T {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

function toBbox(feature: Feature<Geometry, Record<string, unknown>>): number[] {
  const bbox = turf.bbox(feature);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid bbox for feature: ${JSON.stringify(feature.properties)}`);
  }
  return bbox;
}

function buildKreisRows(snapshot: string): GeoBoundaryRow[] {
  const fc = readJson<FeatureCollection<Geometry, KreisProps>>('lib/data/geo/kreise.json');
  const rows: GeoBoundaryRow[] = [];

  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const ags = feature.properties?.ags?.trim();
    const name = feature.properties?.name?.trim();
    if (!ags || !name) continue;

    rows.push({
      level: 'kreis',
      ags,
      name,
      bundesland: feature.properties?.bundesland ?? null,
      geometry: feature.geometry,
      properties: {
        ags,
        name,
        bundesland: feature.properties?.bundesland ?? null,
      },
      bbox: toBbox(feature as Feature<Geometry, Record<string, unknown>>),
      source: 'BKG VG250 via OpenDataSoft',
      source_dataset: 'georef-germany-kreis',
      snapshot,
    });
  }

  return rows;
}

function buildCityRows(snapshot: string): GeoBoundaryRow[] {
  const fc = readJson<FeatureCollection<Geometry, CityProps>>('lib/data/cities-geojson.json');
  const rows: GeoBoundaryRow[] = [];

  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const ags = feature.properties?.ags?.trim();
    const name = feature.properties?.name?.trim();
    if (!ags || !name) continue;

    rows.push({
      level: 'city',
      ags,
      name,
      bundesland: null,
      geometry: feature.geometry,
      properties: {
        ags,
        name,
        state: feature.properties?.state ?? null,
      },
      bbox: toBbox(feature as Feature<Geometry, Record<string, unknown>>),
      source: 'BKG VG250 via OpenDataSoft (filtered to project cities)',
      source_dataset: 'georef-germany-gemeinde',
      snapshot,
    });
  }

  return rows;
}

function buildCountryRow(snapshot: string): GeoBoundaryRow[] {
  const feature = readJson<Feature<Geometry, CountryProps>>('lib/data/geo/germany-boundary.json');
  if (!feature.geometry) return [];

  const name = feature.properties?.name?.trim() || 'Germany';

  return [
    {
      level: 'country',
      ags: 'DE',
      name,
      bundesland: null,
      geometry: feature.geometry,
      properties: { ...(feature.properties ?? {}), ags: 'DE', name },
      bbox: toBbox(feature as Feature<Geometry, Record<string, unknown>>),
      source: 'Project boundary asset',
      source_dataset: 'germany-boundary',
      snapshot,
    },
  ];
}

function dedupeRows(rows: GeoBoundaryRow[]): GeoBoundaryRow[] {
  const map = new Map<string, GeoBoundaryRow>();
  for (const row of rows) {
    map.set(`${row.level}:${row.ags}`, row);
  }
  return Array.from(map.values());
}

async function upsertInBatches(
  supabase: ReturnType<typeof createClient>,
  rows: GeoBoundaryRow[],
  batchSize = 200
): Promise<void> {
  const batches = Math.ceil(rows.length / batchSize);
  for (let i = 0; i < batches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, rows.length);
    const batch = rows.slice(start, end);

    const { error } = await supabase
      .from('geo_boundaries')
      .upsert(batch, { onConflict: 'level,ags', ignoreDuplicates: false });

    if (error) {
      throw new Error(`Batch ${i + 1}/${batches} failed: ${error.message}`);
    }

    console.log(`  Upserted batch ${i + 1}/${batches} (${end}/${rows.length})`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const snapshot = new Date().toISOString().slice(0, 10);

  loadEnv();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      `Missing env vars. NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl ? 'set' : 'missing'}, SUPABASE_SERVICE_ROLE_KEY=${supabaseKey ? 'set' : 'missing'}`
    );
  }

  const allRows = dedupeRows([
    ...buildKreisRows(snapshot),
    ...buildCityRows(snapshot),
    ...buildCountryRow(snapshot),
  ]);

  const counts = allRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.level] = (acc[row.level] ?? 0) + 1;
    return acc;
  }, {});

  console.log('Prepared boundary rows:');
  console.log(`  country: ${counts.country ?? 0}`);
  console.log(`  kreis:   ${counts.kreis ?? 0}`);
  console.log(`  city:    ${counts.city ?? 0}`);
  console.log(`  total:   ${allRows.length}`);

  if (dryRun) {
    console.log('\nDry run only. No database writes performed.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  await upsertInBatches(supabase, allRows);

  const { count, error } = await supabase
    .from('geo_boundaries')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Failed to verify row count: ${error.message}`);
  }

  console.log(`\nDone. geo_boundaries now has ${count ?? 0} rows.`);
}

main().catch((error) => {
  console.error('Boundary migration failed:', error);
  process.exit(1);
});

