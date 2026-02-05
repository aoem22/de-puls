/**
 * Migration script to transfer crime records from local JSON to Supabase
 *
 * Usage:
 *   npx tsx scripts/migrate-to-supabase.ts
 *
 * Environment variables required:
 *   NEXT_PUBLIC_SUPABASE_URL - Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY - Supabase anon key (or service role key for writes)
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Types
interface CrimeRecord {
  id: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  publishedAt: string;
  sourceUrl: string;
  sourceAgency?: string | null;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  precision: string;
  categories: string[];
  weaponType?: string | null;
  confidence: number;
}

interface CrimeDataset {
  generatedAt: string;
  source: string;
  range: { start: string; end: string };
  records: CrimeRecord[];
}

interface CrimeRecordRow {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  published_at: string;
  source_url: string;
  source_agency: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: string;
  categories: string[];
  weapon_type: string | null;
  confidence: number;
}

// Load environment variables from .env file
function loadEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
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

  // Also try .env.local
  const envLocalPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, 'utf-8');
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

// Sanitize timestamp - handle malformed dates like "2023-05-03Tunknown:00"
function sanitizeTimestamp(timestamp: string): string {
  // Replace "unknown" time with midnight
  if (timestamp.includes('unknown')) {
    return timestamp.replace(/Tunknown:00/, 'T00:00:00');
  }
  // Ensure valid ISO format
  if (!timestamp.includes('T')) {
    return timestamp + 'T00:00:00';
  }
  return timestamp;
}

// Transform camelCase record to snake_case database row
function recordToRow(record: CrimeRecord): CrimeRecordRow {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary ?? null,
    body: record.body ?? null,
    published_at: sanitizeTimestamp(record.publishedAt),
    source_url: record.sourceUrl,
    source_agency: record.sourceAgency ?? null,
    location_text: record.locationText ?? null,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    precision: record.precision,
    categories: record.categories,
    weapon_type: record.weaponType ?? null,
    confidence: record.confidence,
  };
}

async function migrate(): Promise<void> {
  console.log('Loading environment variables...');
  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables:');
    console.error('  NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'set' : 'MISSING');
    console.error('  SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'set' : 'MISSING');
    process.exit(1);
  }

  console.log('Connecting to Supabase...');
  console.log('  URL:', supabaseUrl);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load crime data from JSON file
  const jsonPath = path.join(process.cwd(), 'lib/data/blaulicht-crimes.json');
  console.log(`Loading crime data from ${jsonPath}...`);

  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  const dataset: CrimeDataset = JSON.parse(rawData);

  console.log(`Found ${dataset.records.length} records`);
  console.log(`Date range: ${dataset.range.start} to ${dataset.range.end}`);

  // Transform records to database format
  const rows = dataset.records.map(recordToRow);

  // Batch insert with upsert (500 records per batch)
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  console.log(`Inserting in ${totalBatches} batches of ${BATCH_SIZE}...`);

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, rows.length);
    const batch = rows.slice(start, end);

    const { error } = await supabase
      .from('crime_records')
      .upsert(batch, {
        onConflict: 'id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Batch ${i + 1}/${totalBatches} failed:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      console.log(`Batch ${i + 1}/${totalBatches} completed (${inserted}/${rows.length})`);
    }
  }

  console.log('\nMigration complete!');
  console.log(`  Inserted/updated: ${inserted}`);
  console.log(`  Errors: ${errors}`);

  // Verify by counting records
  const { count, error: countError } = await supabase
    .from('crime_records')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error counting records:', countError.message);
  } else {
    console.log(`  Total records in database: ${count}`);
  }
}

// Run migration
migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
