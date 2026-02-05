/**
 * Migration script to transfer indicator datasets to Supabase
 * Migrates: auslaender, deutschlandatlas, city-crimes → 4 Supabase tables
 *
 * Usage:
 *   npx tsx scripts/migrate-indicators-to-supabase.ts
 *
 * Environment variables required:
 *   NEXT_PUBLIC_SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (required for RLS-protected writes)
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ============ Types ============

interface AuslaenderRecord {
  ags: string;
  name: string;
  regions: Record<string, { male: number | null; female: number | null; total: number | null }>;
}

interface AuslaenderDataset {
  meta: { source: string; description: string; years: string[] };
  data: Record<string, Record<string, AuslaenderRecord>>;
}

interface DeutschlandatlasRecord {
  ags: string;
  name: string;
  indicators: Record<string, number | null>;
}

interface DeutschlandatlasDataset {
  meta: { source: string; description: string; year: string; indicatorKeys: string[] };
  data: Record<string, DeutschlandatlasRecord>;
}

interface CityData {
  name: string;
  gemeindeschluessel: string;
  crimes: Record<string, { cases: number; hz: number; aq: number }>;
}

interface CityCrimesDataset {
  generatedAt: string;
  source: string;
  years: string[];
  dataByYear: Record<string, Record<string, CityData>>;
}

// DB row types
interface AuslaenderRow { ags: string; year: string; name: string; regions: unknown }
interface DeutschlandatlasRow { ags: string; year: string; name: string; indicators: unknown }
interface CityCrimeRow { ags: string; year: string; name: string; crimes: unknown }
interface DatasetMetaRow { dataset: string; years: string[]; source: string | null; description: string | null }

// ============ Helpers ============

function loadEnv(): void {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(process.cwd(), filename);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=');
          if (key && value) {
            process.env[key] = value;
          }
        }
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

async function batchUpsert<T extends Record<string, unknown>>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: T[],
  conflictColumns: string,
  batchSize = 500
): Promise<{ inserted: number; errors: number }> {
  const totalBatches = Math.ceil(rows.length / batchSize);
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, rows.length);
    const batch = rows.slice(start, end);

    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictColumns, ignoreDuplicates: false });

    if (error) {
      console.error(`  Batch ${i + 1}/${totalBatches} failed:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      if (totalBatches > 1) {
        console.log(`  Batch ${i + 1}/${totalBatches} (${inserted}/${rows.length})`);
      }
    }
  }

  return { inserted, errors };
}

// ============ Migration Functions ============

async function migrateAuslaender(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n=== Migrating Ausländer data ===');
  const dataset = readJson<AuslaenderDataset>('lib/data/indicators/auslaender.json');

  const rows: AuslaenderRow[] = [];
  for (const [year, yearData] of Object.entries(dataset.data)) {
    for (const [ags, record] of Object.entries(yearData)) {
      rows.push({ ags, year, name: record.name, regions: record.regions });
    }
  }

  console.log(`  ${rows.length} rows to insert (${dataset.meta.years.length} years)`);
  const result = await batchUpsert(supabase, 'auslaender_data', rows, 'ags,year');
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
}

async function migrateDeutschlandatlas(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n=== Migrating Deutschlandatlas data ===');
  const dataset = readJson<DeutschlandatlasDataset>('lib/data/indicators/deutschlandatlas.json');

  const year = String(dataset.meta.year);
  const rows: DeutschlandatlasRow[] = [];
  for (const [ags, record] of Object.entries(dataset.data)) {
    rows.push({ ags, year, name: record.name, indicators: record.indicators });
  }

  console.log(`  ${rows.length} rows to insert (year: ${year})`);
  const result = await batchUpsert(supabase, 'deutschlandatlas_data', rows, 'ags,year');
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
}

async function migrateCityCrimes(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n=== Migrating City Crime data ===');
  const dataset = readJson<CityCrimesDataset>('lib/data/city-crimes.json');

  const rows: CityCrimeRow[] = [];
  for (const [year, yearData] of Object.entries(dataset.dataByYear)) {
    for (const [ags, city] of Object.entries(yearData)) {
      rows.push({ ags, year, name: city.name, crimes: city.crimes });
    }
  }

  console.log(`  ${rows.length} rows to insert (${dataset.years.length} years)`);
  const result = await batchUpsert(supabase, 'city_crime_data', rows, 'ags,year');
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
}

async function migrateMetadata(supabase: ReturnType<typeof createClient>): Promise<void> {
  console.log('\n=== Migrating dataset metadata ===');

  const auslaender = readJson<AuslaenderDataset>('lib/data/indicators/auslaender.json');
  const deutschlandatlas = readJson<DeutschlandatlasDataset>('lib/data/indicators/deutschlandatlas.json');
  const cityCrimes = readJson<CityCrimesDataset>('lib/data/city-crimes.json');

  const metaRows: DatasetMetaRow[] = [
    {
      dataset: 'auslaender',
      years: auslaender.meta.years,
      source: auslaender.meta.source,
      description: auslaender.meta.description,
    },
    {
      dataset: 'deutschlandatlas',
      years: [String(deutschlandatlas.meta.year)],
      source: deutschlandatlas.meta.source,
      description: deutschlandatlas.meta.description,
    },
    {
      dataset: 'kriminalstatistik',
      years: cityCrimes.years,
      source: cityCrimes.source,
      description: 'Polizeiliche Kriminalstatistik - Städte',
    },
  ];

  const result = await batchUpsert(supabase, 'dataset_meta', metaRows, 'dataset');
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
}

// ============ Main ============

async function migrate(): Promise<void> {
  console.log('Loading environment variables...');
  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables:');
    console.error('  NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'MISSING');
    console.error('  SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'set' : 'MISSING');
    process.exit(1);
  }

  console.log('Connecting to Supabase...');
  console.log('  URL:', supabaseUrl);

  const supabase = createClient(supabaseUrl, supabaseKey);

  await migrateAuslaender(supabase);
  await migrateDeutschlandatlas(supabase);
  await migrateCityCrimes(supabase);
  await migrateMetadata(supabase);

  // Verify counts
  console.log('\n=== Verifying row counts ===');
  for (const table of ['auslaender_data', 'deutschlandatlas_data', 'city_crime_data', 'dataset_meta']) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`  ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`  ${table}: ${count} rows`);
    }
  }

  console.log('\nMigration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
