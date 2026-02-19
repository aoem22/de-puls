import { supabase } from './client';
import type {
  CrimeRecordRow,
  AuslaenderRow,
  DeutschlandatlasRow,
  CityCrimeRow,
} from './types';
import type { CrimeRecord, CrimeCategory } from '../types/crime';
import {
  normalizeBoundaryGeometry,
  isPointInBoundary,
  type BoundaryGeometry,
} from '../geo-utils';

export type { BoundaryGeometry };

// ---------------------------------------------------------------------------
// Row → CrimeRecord transform (same as queries.ts)
// ---------------------------------------------------------------------------

function rowToCrimeRecord(row: CrimeRecordRow): CrimeRecord {
  return {
    id: row.id,
    title: row.title,
    cleanTitle: row.clean_title,
    body: row.body,
    district: row.district,
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
    city: row.city,
    plz: row.plz,
    bundesland: row.bundesland,
  };
}

// ---------------------------------------------------------------------------
// Kreis page data (overview page)
// ---------------------------------------------------------------------------

export interface KreisPageData {
  auslaender: AuslaenderRow | null;
  deutschlandatlas: DeutschlandatlasRow | null;
  cityCrime: CityCrimeRow | null;
  bbox: number[] | null;
  boundaryGeometry: BoundaryGeometry | null;
}

export async function fetchKreisPageData(ags: string): Promise<KreisPageData> {
  const [ausRes, atlasRes, crimeRes, geoRes] = await Promise.all([
    supabase.from('auslaender_data').select('*').eq('ags', ags).limit(1).maybeSingle(),
    supabase.from('deutschlandatlas_data').select('*').eq('ags', ags).limit(1).maybeSingle(),
    supabase.from('city_crime_data').select('*').eq('ags', ags).order('year', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('geo_boundaries').select('bbox, geometry').eq('ags', ags).eq('level', 'kreis').limit(1).maybeSingle(),
  ]);

  const geo = geoRes.data as { bbox?: number[]; geometry?: unknown } | null;

  return {
    auslaender: (ausRes.data as unknown as AuslaenderRow) ?? null,
    deutschlandatlas: (atlasRes.data as unknown as DeutschlandatlasRow) ?? null,
    cityCrime: (crimeRes.data as unknown as CityCrimeRow) ?? null,
    bbox: geo?.bbox ?? null,
    boundaryGeometry: normalizeBoundaryGeometry(geo?.geometry),
  };
}

// ---------------------------------------------------------------------------
// Blaulicht records within a bounding box
// ---------------------------------------------------------------------------

export async function fetchCrimeRecordsByBbox(
  bbox: number[],
  category?: CrimeCategory,
  limit = 10,
  boundaryGeometry?: BoundaryGeometry | null,
): Promise<CrimeRecord[]> {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  if (!boundaryGeometry) {
    let query = supabase
      .from('crime_records')
      .select('*')
      .eq('hidden', false)
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLon)
      .lte('longitude', maxLon)
      .order('sort_date', { ascending: false })
      .limit(limit);

    if (category) {
      query = query.contains('categories', [category]);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching crime records by bbox:', error);
      return [];
    }

    return ((data ?? []) as CrimeRecordRow[]).map(rowToCrimeRecord);
  }

  const PAGE_SIZE = Math.max(50, limit * 4);
  const filtered: CrimeRecord[] = [];
  let from = 0;

  while (filtered.length < limit) {
    let query = supabase
      .from('crime_records')
      .select('*')
      .eq('hidden', false)
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLon)
      .lte('longitude', maxLon)
      .order('sort_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (category) {
      query = query.contains('categories', [category]);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching boundary-filtered crime records:', error);
      return filtered;
    }

    const rows = (data ?? []) as CrimeRecordRow[];
    for (const row of rows) {
      if (row.latitude == null || row.longitude == null) continue;
      if (!isPointInBoundary(row.longitude, row.latitude, boundaryGeometry)) continue;
      filtered.push(rowToCrimeRecord(row));
      if (filtered.length >= limit) break;
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Crime counts by category within a bbox
// ---------------------------------------------------------------------------

export async function fetchCrimeCountsByBbox(
  bbox: number[],
  boundaryGeometry?: BoundaryGeometry | null,
): Promise<Partial<Record<CrimeCategory, number>>> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const PAGE_SIZE = 1000;
  const counts: Partial<Record<CrimeCategory, number>> = {};
  let from = 0;

  while (true) {
    const selectFields = boundaryGeometry
      ? 'categories, latitude, longitude'
      : 'categories';
    const { data, error } = await supabase
      .from('crime_records')
      .select(selectFields)
      .eq('hidden', false)
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLon)
      .lte('longitude', maxLon)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching crime counts:', error);
      break;
    }

    const rows = (data ?? []) as Array<{
      categories: CrimeCategory[];
      latitude?: number | null;
      longitude?: number | null;
    }>;

    for (const row of rows) {
      if (boundaryGeometry) {
        const lat = row.latitude;
        const lon = row.longitude;
        if (lat == null || lon == null) continue;
        if (!isPointInBoundary(lon, lat, boundaryGeometry)) continue;
      }

      for (const cat of row.categories) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// City ranking by crime rate
// ---------------------------------------------------------------------------

export interface CityRankingEntry {
  ags: string;
  name: string;
  hz: number;
  cases: number;
  aq: number;
}

export async function fetchCityRanking(
  crimeTypeKey?: string,
): Promise<CityRankingEntry[]> {
  const { data, error } = await supabase
    .from('city_crime_data')
    .select('*')
    .order('year', { ascending: false });

  if (error) {
    console.error('Error fetching city ranking:', error);
    return [];
  }

  const rows = (data ?? []) as unknown as CityCrimeRow[];

  // Get the most recent year per AGS
  const latestByAgs = new Map<string, CityCrimeRow>();
  for (const row of rows) {
    if (!latestByAgs.has(row.ags)) {
      latestByAgs.set(row.ags, row);
    }
  }

  const ranking: CityRankingEntry[] = [];

  for (const [, row] of latestByAgs) {
    const crimes = row.crimes as Record<string, { cases: number; hz: number; aq: number }>;
    if (crimeTypeKey && crimes[crimeTypeKey]) {
      const c = crimes[crimeTypeKey];
      ranking.push({ ags: row.ags, name: row.name, hz: c.hz, cases: c.cases, aq: c.aq });
    } else if (!crimeTypeKey) {
      // Sum all categories
      let totalCases = 0;
      let totalHZ = 0;
      let totalAQ = 0;
      let count = 0;
      for (const c of Object.values(crimes)) {
        totalCases += c.cases;
        totalHZ += c.hz;
        totalAQ += c.aq;
        count++;
      }
      ranking.push({
        ags: row.ags,
        name: row.name,
        hz: totalHZ,
        cases: totalCases,
        aq: count > 0 ? totalAQ / count : 0,
      });
    }
  }

  ranking.sort((a, b) => b.hz - a.hz);
  return ranking;
}

// ---------------------------------------------------------------------------
// Fetch bbox for a single Kreis
// ---------------------------------------------------------------------------

export async function fetchKreisBbox(ags: string): Promise<number[] | null> {
  const { data, error } = await supabase
    .from('geo_boundaries')
    .select('bbox')
    .eq('ags', ags)
    .eq('level', 'kreis')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { bbox: number[] }).bbox;
}
