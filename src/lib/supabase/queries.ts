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
 * Transform database row (snake_case) to application model (camelCase).
 * Accepts partial rows from slim queries — missing fields become undefined.
 */
function rowToCrimeRecord(row: Partial<CrimeRecordRow>): CrimeRecord {
  return {
    id: row.id!,
    title: row.title!,
    cleanTitle: row.clean_title,
    body: row.body,
    district: row.district,
    publishedAt: row.published_at!,
    sourceUrl: row.source_url!,
    sourceAgency: row.source_agency,
    locationText: row.location_text,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision ?? 'city',
    categories: row.categories ?? [],
    weaponType: row.weapon_type ?? undefined,
    confidence: row.confidence ?? 0,
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    incidentTimePrecision: row.incident_time_precision,
    incidentEndDate: row.incident_end_date,
    incidentEndTime: row.incident_end_time,
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
    victimDescription: row.victim_description,
    suspectDescription: row.suspect_description,
    severity: row.severity,
    motive: row.motive,
    incidentGroupId: row.incident_group_id,
    groupRole: row.group_role,
    pipelineRun: row.pipeline_run,
    classification: row.classification,
    bundesland: row.bundesland,
  };
}

// Slim column set for map rendering & filtering (excludes heavy text fields)
const SLIM_COLUMNS = 'id, title, clean_title, published_at, source_url, latitude, longitude, categories, weapon_type, confidence, incident_group_id, group_role, pipeline_run, classification, bundesland';

/**
 * Fetch all crime records via the cached server API route.
 * The API route handles pagination and caching server-side.
 *
 * @param category - Optional category to filter by
 * @param pipelineRun - Optional pipeline run filter
 * @returns Array of crime records (slim)
 */
export async function fetchCrimes(category?: CrimeCategory, pipelineRun?: string): Promise<CrimeRecord[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (pipelineRun) params.set('pipeline_run', pipelineRun);
  const url = `/api/map/crimes${params.toString() ? `?${params}` : ''}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch crimes: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<CrimeRecord[]>;
}

/**
 * Server-side fetch of all crime records with pagination.
 * Used by the /api/map/crimes route handler.
 */
export async function fetchCrimesFromSupabase(category?: CrimeCategory, pipelineRun?: string): Promise<CrimeRecord[]> {
  const PAGE_SIZE = 1000;
  let allData: Partial<CrimeRecordRow>[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('crime_records')
      .select(SLIM_COLUMNS)
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

    const rows = (data ?? []) as Partial<CrimeRecordRow>[];
    allData = allData.concat(rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allData.map(rowToCrimeRecord);
}

/**
 * Fetch a single crime record by ID with all columns (for detail panel)
 */
export async function fetchCrimeById(id: string): Promise<CrimeRecord | null> {
  const { data, error } = await supabase
    .from('crime_records')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching crime by ID:', error);
    return null;
  }

  return rowToCrimeRecord(data as CrimeRecordRow);
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
 * Uses the get_pipeline_run_counts RPC function for a single SQL GROUP BY.
 */
export async function fetchPipelineRuns(): Promise<Array<{ run: string; count: number }>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('get_pipeline_run_counts');
    if (error) throw error;

    return ((data ?? []) as Array<{ pipeline_run: string; count: number }>)
      .map((row) => ({ run: row.pipeline_run, count: Number(row.count) }));
  } catch (err) {
    console.error('Error fetching pipeline runs:', err);
    return [];
  }
}

// ============ Dashboard Queries ============

/**
 * Fetch category counts for the dashboard, filtered by timeframe.
 * Returns count per category and weapon type, plus total.
 */
export async function fetchDashboardStats(
  timeframeDays: number | null
): Promise<{
  byCategory: Partial<Record<CrimeCategory, number>>;
  byWeapon: Record<string, number>;
  total: number;
}> {
  const PAGE_SIZE = 1000;
  const records: Array<{ categories: CrimeCategory[]; weapon_type: string | null }> = [];
  let from = 0;

  const cutoff = timeframeDays
    ? new Date(Date.now() - timeframeDays * 86400000).toISOString()
    : null;

  while (true) {
    let query = supabase
      .from('crime_records')
      .select('categories, weapon_type')
      .eq('hidden', false)
      .order('published_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (cutoff) {
      query = query.gte('published_at', cutoff);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Dashboard stats: ${error.message}`);

    const rows = (data ?? []) as Array<{ categories: CrimeCategory[]; weapon_type: string | null }>;
    records.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const byCategory: Partial<Record<CrimeCategory, number>> = {};
  const byWeapon: Record<string, number> = {};

  for (const rec of records) {
    for (const cat of rec.categories) {
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    if (rec.weapon_type && rec.weapon_type !== 'none' && rec.weapon_type !== 'unknown') {
      byWeapon[rec.weapon_type] = (byWeapon[rec.weapon_type] || 0) + 1;
    }
  }

  return { byCategory, byWeapon, total: records.length };
}

/**
 * Fetch city ranking by weapon type or category for the dashboard.
 * Groups records by location_text city, returns top N.
 */
export async function fetchCityRankingByCategory(
  category: CrimeCategory,
  timeframeDays: number | null,
  limit: number = 10
): Promise<Array<{ city: string; count: number }>> {
  const PAGE_SIZE = 1000;
  const records: Array<{ location_text: string | null }> = [];
  let from = 0;

  const cutoff = timeframeDays
    ? new Date(Date.now() - timeframeDays * 86400000).toISOString()
    : null;

  while (true) {
    let query = supabase
      .from('crime_records')
      .select('location_text')
      .eq('hidden', false)
      .contains('categories', [category])
      .not('latitude', 'is', null)
      .range(from, from + PAGE_SIZE - 1);

    if (cutoff) {
      query = query.gte('published_at', cutoff);
    }

    const { data, error } = await query;
    if (error) throw new Error(`City ranking: ${error.message}`);

    const rows = (data ?? []) as Array<{ location_text: string | null }>;
    records.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Extract city name from location_text (typically "City" or "City-District")
  const cityCounts: Record<string, number> = {};
  for (const rec of records) {
    if (!rec.location_text) continue;
    // Take the primary city name (before comma or dash details)
    const city = rec.location_text.split(',')[0].split(' - ')[0].split('/')[0].trim();
    if (city) {
      cityCounts[city] = (cityCounts[city] || 0) + 1;
    }
  }

  return Object.entries(cityCounts)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Fetch worst Kreise by overall crime rate (HZ) from deutschlandatlas_data.
 * Uses the "Straftaten" indicator.
 */
export async function fetchHotspotKreise(
  limit: number = 10
): Promise<Array<{ ags: string; name: string; hz: number }>> {
  const { data, error } = await supabase
    .from('deutschlandatlas_data')
    .select('ags, name, indicators');

  if (error) throw new Error(`Hotspot Kreise: ${error.message}`);

  const rows = (data ?? []) as unknown as DeutschlandatlasRow[];
  const results: Array<{ ags: string; name: string; hz: number }> = [];

  for (const row of rows) {
    // The "straft" indicator contains the crime rate (HZ per 100k)
    const hz = row.indicators?.['straft'];
    if (hz != null && typeof hz === 'number') {
      results.push({ ags: row.ags, name: row.name, hz });
    }
  }

  return results
    .sort((a, b) => b.hz - a.hz)
    .slice(0, limit);
}

/**
 * Fetch paginated live feed of violent crime records.
 * Filters to knife, murder, or sexual categories.
 */
export async function fetchLiveFeed(
  categories: CrimeCategory[],
  offset: number = 0,
  limit: number = 10
): Promise<CrimeRecord[]> {
  // Build an OR filter for overlapping categories
  let query = supabase
    .from('crime_records')
    .select('id, title, clean_title, published_at, source_url, latitude, longitude, location_text, categories, weapon_type, severity')
    .eq('hidden', false)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (categories.length === 1) {
    query = query.contains('categories', categories);
  } else if (categories.length > 1) {
    // Use OR filter: match any of the categories
    const orFilter = categories.map(c => `categories.cs.{${c}}`).join(',');
    query = query.or(orFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Live feed: ${error.message}`);

  return ((data ?? []) as Partial<CrimeRecordRow>[]).map(rowToCrimeRecord);
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
