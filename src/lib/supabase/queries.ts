import { supabase } from './client';
import type { CrimeRecordRow, BlaulichtStats, AuslaenderRow, DeutschlandatlasRow, CityCrimeRow, DatasetMetaRow } from './types';
import type { CrimeRecord, CrimeCategory } from '../types/crime';

/**
 * Transform database row (snake_case) to application model (camelCase)
 */
function rowToCrimeRecord(row: CrimeRecordRow): CrimeRecord {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
    sourceAgency: row.source_agency,
    locationText: row.location_text,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision,
    categories: row.categories,
    weaponType: row.weapon_type,
    confidence: row.confidence,
  };
}

/**
 * Fetch all crime records, optionally filtered by category
 *
 * @param category - Optional category to filter by
 * @returns Array of crime records
 */
export async function fetchCrimes(category?: CrimeCategory): Promise<CrimeRecord[]> {
  let query = supabase
    .from('crime_records')
    .select('*')
    .order('published_at', { ascending: false });

  // Filter by category if provided (categories is an array, use contains)
  if (category) {
    query = query.contains('categories', [category]);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching crimes:', error);
    throw new Error(`Failed to fetch crimes: ${error.message}`);
  }

  return (data ?? []).map(rowToCrimeRecord);
}

/**
 * Fetch aggregate statistics for Blaulicht crime data
 *
 * @returns Statistics including total count, geocoded count, and counts by category
 */
export async function fetchCrimeStats(): Promise<BlaulichtStats> {
  // Fetch all records to compute stats
  // In production with large datasets, this should use database aggregations
  const { data, error } = await supabase
    .from('crime_records')
    .select('latitude, categories');

  if (error) {
    console.error('Error fetching crime stats:', error);
    throw new Error(`Failed to fetch crime stats: ${error.message}`);
  }

  // Type the records properly for the partial select
  const records = (data ?? []) as Array<{ latitude: number | null; categories: CrimeCategory[] }>;

  const byCategory: Partial<Record<CrimeCategory, number>> = {};
  let geocoded = 0;

  for (const record of records) {
    if (record.latitude != null) {
      geocoded++;
    }
    for (const cat of record.categories) {
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
  }

  return {
    total: records.length,
    geocoded,
    byCategory,
  };
}

// ============ Indicator Data Queries ============

/**
 * Fetch Ausländer data for a single year, keyed by AGS
 */
export async function fetchAuslaenderByYear(year: string): Promise<Record<string, AuslaenderRow>> {
  const { data, error } = await supabase
    .from('auslaender_data')
    .select('*')
    .eq('year', year);

  if (error) {
    console.error('Error fetching auslaender data:', error);
    throw new Error(`Failed to fetch auslaender data: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as AuslaenderRow[];
  const result: Record<string, AuslaenderRow> = {};
  for (const row of rows) {
    result[row.ags] = row;
  }
  return result;
}

/**
 * Fetch all Deutschlandatlas data (single year), keyed by AGS
 */
export async function fetchDeutschlandatlas(): Promise<Record<string, DeutschlandatlasRow>> {
  const { data, error } = await supabase
    .from('deutschlandatlas_data')
    .select('*');

  if (error) {
    console.error('Error fetching deutschlandatlas data:', error);
    throw new Error(`Failed to fetch deutschlandatlas data: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as DeutschlandatlasRow[];
  const result: Record<string, DeutschlandatlasRow> = {};
  for (const row of rows) {
    result[row.ags] = row;
  }
  return result;
}

/**
 * Fetch all city crime data across all years
 * Returns nested map: { year: { ags: CityCrimeRow } }
 */
export async function fetchAllCityCrimes(): Promise<Record<string, Record<string, CityCrimeRow>>> {
  const { data, error } = await supabase
    .from('city_crime_data')
    .select('*');

  if (error) {
    console.error('Error fetching city crime data:', error);
    throw new Error(`Failed to fetch city crime data: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as CityCrimeRow[];
  const result: Record<string, Record<string, CityCrimeRow>> = {};
  for (const row of rows) {
    if (!result[row.year]) {
      result[row.year] = {};
    }
    result[row.year][row.ags] = row;
  }
  return result;
}

/**
 * Fetch dataset metadata (available years, source)
 */
export async function fetchDatasetMeta(dataset: string): Promise<DatasetMetaRow | null> {
  const { data, error } = await supabase
    .from('dataset_meta')
    .select('*')
    .eq('dataset', dataset)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching dataset meta:', error);
    throw new Error(`Failed to fetch dataset meta: ${error.message}`);
  }

  return data as unknown as DatasetMetaRow;
}

/**
 * Fetch all dataset metadata at once
 */
export async function fetchAllDatasetMeta(): Promise<Record<string, DatasetMetaRow>> {
  const { data, error } = await supabase
    .from('dataset_meta')
    .select('*');

  if (error) {
    console.error('Error fetching all dataset meta:', error);
    throw new Error(`Failed to fetch all dataset meta: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as DatasetMetaRow[];
  const result: Record<string, DatasetMetaRow> = {};
  for (const row of rows) {
    result[row.dataset] = row;
  }
  return result;
}
