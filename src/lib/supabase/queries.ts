import { supabase } from './client';
import type {
  CrimeRecordRow,
  BlaulichtStats,
  AuslaenderRow,
  DeutschlandatlasRow,
  CityCrimeRow,
  DatasetMetaRow,
  GeoBoundaryRow,
} from './types';
import type { CrimeRecord, CrimeCategory } from '../types/crime';

/**
 * Transform database row (snake_case) to application model (camelCase)
 */
function rowToCrimeRecord(row: CrimeRecordRow): CrimeRecord {
  return {
    id: row.id,
    title: row.title,
    cleanTitle: row.clean_title,
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
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    incidentTimePrecision: row.incident_time_precision,
    crimeSubType: row.crime_sub_type,
    crimeConfidence: row.crime_confidence,
    drugType: row.drug_type,
    victimCount: row.victim_count,
    suspectCount: row.suspect_count,
    victimAge: row.victim_age,
    suspectAge: row.suspect_age,
    victimGender: row.victim_gender,
    suspectGender: row.suspect_gender,
    victimHerkunft: row.victim_herkunft,
    suspectHerkunft: row.suspect_herkunft,
    severity: row.severity,
    motive: row.motive,
    incidentGroupId: row.incident_group_id,
    groupRole: row.group_role,
    pipelineRun: row.pipeline_run,
  };
}

/**
 * Fetch all crime records, optionally filtered by category
 *
 * @param category - Optional category to filter by
 * @returns Array of crime records
 */
export async function fetchCrimes(category?: CrimeCategory, pipelineRun?: string): Promise<CrimeRecord[]> {
  const PAGE_SIZE = 1000;
  let allData: CrimeRecordRow[] = [];
  let from = 0;

  // Paginate to avoid Supabase's default 1000-row limit
  while (true) {
    let query = supabase
      .from('crime_records')
      .select('*')
      .eq('hidden', false)
      .order('published_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (category) {
      query = query.contains('categories', [category]);
    }

    if (pipelineRun) {
      query = query.eq('pipeline_run', pipelineRun);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching crimes:', error);
      throw new Error(`Failed to fetch crimes: ${error.message}`);
    }

    const rows = (data ?? []) as CrimeRecordRow[];
    allData = allData.concat(rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allData.map(rowToCrimeRecord);
}

/**
 * Fetch aggregate statistics for Blaulicht crime data
 *
 * @returns Statistics including total count, geocoded count, and counts by category
 */
export async function fetchCrimeStats(): Promise<BlaulichtStats> {
  // Fetch all records to compute stats, paginating past 1000-row limit
  const PAGE_SIZE = 1000;
  const records: Array<{ latitude: number | null; categories: CrimeCategory[] }> = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('crime_records')
      .select('latitude, categories')
      .eq('hidden', false)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching crime stats:', error);
      throw new Error(`Failed to fetch crime stats: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ latitude: number | null; categories: CrimeCategory[] }>;
    records.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

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

/**
 * Fetch related articles in the same incident group (for timeline view)
 */
export async function fetchRelatedArticles(groupId: string): Promise<CrimeRecord[]> {
  const { data, error } = await supabase
    .from('crime_records')
    .select('*')
    .eq('incident_group_id', groupId)
    .eq('hidden', false)
    .order('published_at', { ascending: true });

  if (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }

  return ((data ?? []) as CrimeRecordRow[]).map(rowToCrimeRecord);
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

/**
 * Fetch boundaries by level, keyed by AGS
 */
/**
 * Fetch distinct pipeline run names with record counts.
 * Used for the experiment toggle in LayerControl.
 */
export async function fetchPipelineRuns(): Promise<Array<{ run: string; count: number }>> {
  // Supabase doesn't support GROUP BY directly, so fetch all pipeline_run values
  const PAGE_SIZE = 1000;
  const runs: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('crime_records')
      .select('pipeline_run')
      .eq('hidden', false)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching pipeline runs:', error);
      return [];
    }

    const rows = (data ?? []) as Array<{ pipeline_run: string }>;
    for (const row of rows) {
      runs.push(row.pipeline_run ?? 'default');
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Aggregate counts
  const counts: Record<string, number> = {};
  for (const run of runs) {
    counts[run] = (counts[run] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([run, count]) => ({ run, count }))
    .sort((a, b) => b.count - a.count);
}

export async function fetchGeoBoundaries(level: GeoBoundaryRow['level']): Promise<Record<string, GeoBoundaryRow>> {
  const { data, error } = await supabase
    .from('geo_boundaries')
    .select('*')
    .eq('level', level);

  if (error) {
    console.error('Error fetching geo boundaries:', error);
    throw new Error(`Failed to fetch geo boundaries: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as GeoBoundaryRow[];
  const result: Record<string, GeoBoundaryRow> = {};
  for (const row of rows) {
    result[row.ags] = row;
  }
  return result;
}
