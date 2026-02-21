/**
 * Server-side Supabase queries for the dashboard API.
 *
 * Uses RPC functions for aggregations (weapon/drug/city/kreis/context stats).
 * Falls back to fetchAllRows when drug-type filter is active (requires JS normalization).
 */

import { supabase } from './client';
import type { CrimeCategory } from '@/lib/types/crime';
import { extractDrugTypes, hasSelectedDrugType } from '@/lib/utils/drug-parser';
import { parseAges } from '@/lib/utils/age-parser';

// Typed RPC helper — avoids fighting with Supabase's strict generics
// for custom functions that aren't in the auto-generated Database type.
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(`${name} RPC error: ${(error as { message: string }).message}`);
  return data as T;
}

// ────────────────────────── Shared filter builder ──────────────────────────

/**
 * Classification filter applied to every query:
 * include crime, update, and NULL (legacy records without classification).
 */
function applyClassificationFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
) {
  return query
    .or('classification.in.(crime,update),classification.is.null')
    .eq('hidden', false);
}

function applyTimeFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  startIso: string,
  endIso: string,
) {
  return query.gte('sort_date', startIso).lt('sort_date', endIso);
}

function applyCategoryFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  category: CrimeCategory | null,
) {
  if (category) {
    return query.contains('categories', [category]);
  }
  return query;
}

function applyWeaponFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  weaponType: string | null,
) {
  if (weaponType) {
    return query.contains('weapon_types', [weaponType]);
  }
  return query;
}

function applyPipelineRunFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  pipelineRun: string | null,
) {
  if (pipelineRun) {
    return query.eq('pipeline_run', pipelineRun);
  }
  return query;
}

function applyBundeslandFilter(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  bundesland: string | null,
) {
  if (bundesland) {
    return query.eq('bundesland', bundesland);
  }
  return query;
}

type QueryBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>;

function applyBaseFilters(
  query: QueryBuilder,
  opts: {
    startIso?: string;
    endIso?: string;
    category?: CrimeCategory | null;
    weaponType?: string | null;
    pipelineRun?: string | null;
    bundesland?: string | null;
  },
): QueryBuilder {
  let q = applyClassificationFilter(query);
  if (opts.startIso && opts.endIso) {
    q = applyTimeFilter(q, opts.startIso, opts.endIso);
  }
  q = applyCategoryFilter(q, opts.category ?? null);
  q = applyWeaponFilter(q, opts.weaponType ?? null);
  q = applyPipelineRunFilter(q, opts.pipelineRun ?? null);
  q = applyBundeslandFilter(q, opts.bundesland ?? null);
  return q;
}

// ────────────────────────── Paginated fetch helper ──────────────────────────

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => QueryBuilder,
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await buildQuery(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase query error: ${error.message}`);
    const rows = (data ?? []) as T[];
    allRows.push(...rows);
    hasMore = rows.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// ────────────────────────── City name normalization (mirrors SQL normalize_city_name) ──────────────────────────

const BERLIN_DISTRICTS = new Set([
  'Mitte', 'Neukölln', 'Reinickendorf', 'Steglitz-Zehlendorf',
  'Treptow-Köpenick', 'Friedrichshain-Kreuzberg', 'Charlottenburg-Wilmersdorf',
  'Spandau', 'Tempelhof-Schöneberg', 'Marzahn-Hellersdorf',
  'Lichtenberg', 'Pankow', 'Kreuzberg', 'Friedrichshain',
  'Charlottenburg', 'Wilmersdorf', 'Schöneberg', 'Tempelhof',
  'Steglitz', 'Zehlendorf', 'Treptow', 'Köpenick',
  'Marzahn', 'Hellersdorf', 'Prenzlauer Berg', 'Wedding',
  'Moabit', 'Tiergarten', 'Gesundbrunnen',
]);

const DISTRICT_SUFFIX_CITIES = new Set([
  'Stuttgart', 'Hamm', 'Köln', 'Dortmund', 'Essen', 'Duisburg',
  'Düsseldorf', 'Bochum', 'Wuppertal', 'Bielefeld', 'Gelsenkirchen',
  'Mönchengladbach', 'Krefeld', 'Oberhausen', 'Hagen', 'Bottrop',
  'Recklinghausen', 'Remscheid', 'Solingen', 'Herne', 'Mülheim',
  'Bonn', 'Münster', 'Mannheim', 'Karlsruhe', 'Freiburg',
  'Heidelberg', 'Ulm', 'Pforzheim', 'Reutlingen', 'Heilbronn',
  'München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Würzburg',
  'Erlangen', 'Fürth', 'Ingolstadt', 'Bamberg',
  'Frankfurt', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach',
  'Hannover', 'Braunschweig', 'Oldenburg', 'Osnabrück', 'Wolfsburg',
  'Göttingen', 'Hildesheim', 'Salzgitter',
  'Bremen', 'Bremerhaven',
  'Leipzig', 'Dresden', 'Chemnitz',
  'Magdeburg', 'Halle',
  'Erfurt', 'Jena', 'Weimar',
  'Rostock', 'Schwerin',
  'Kiel', 'Lübeck', 'Flensburg',
  'Mainz', 'Ludwigshafen', 'Koblenz', 'Trier',
  'Saarbrücken',
]);

const COMPOUND_CITY_EXCLUSIONS = new Set([
  'Baden-Baden', 'Castrop-Rauxel', 'Halle-Neustadt', 'Frankfurt-Oder',
]);

function normalizeCityName(city: string | null, bundesland: string | null): string | null {
  if (!city || !city.trim()) return null;

  // Unicode dash normalization (U+2011 → regular hyphen)
  const c = city.trim().replace(/\u2011/g, '-');

  // Kreis-as-city exclusion
  if (/(?:land)?kreis/i.test(c)) return null;

  // Berlin districts → "Berlin"
  if (bundesland === 'Berlin') {
    if (BERLIN_DISTRICTS.has(c)) return 'Berlin';
    if (c.startsWith('Berlin-')) return 'Berlin';
    return c || 'Berlin';
  }

  // Frankfurt normalization
  if (c === 'Frankfurt' && (bundesland === 'Hessen' || !bundesland)) {
    return 'Frankfurt am Main';
  }

  // City-District suffix stripping
  const dashIdx = c.indexOf('-');
  if (dashIdx > 0) {
    const base = c.slice(0, dashIdx);
    if (DISTRICT_SUFFIX_CITIES.has(base) && !COMPOUND_CITY_EXCLUSIONS.has(c)) {
      if (base === 'Frankfurt' && bundesland === 'Brandenburg') return c;
      return base;
    }
  }

  return c;
}

// ────────────────────────── Drug type filtering (post-fetch) ──────────────────────────

function filterByDrugType<T extends { drug_type: string | null }>(
  rows: T[],
  drugType: string | null,
): T[] {
  if (!drugType) return rows;
  const selectedDrugTypes = new Set(extractDrugTypes(drugType));
  if (selectedDrugTypes.size === 0) return [];
  return rows.filter((r) => hasSelectedDrugType(r.drug_type, selectedDrugTypes));
}

// ────────────────────────── Exported query functions ──────────────────────────

export interface CountOptions {
  startIso?: string;
  endIso?: string;
  category?: CrimeCategory | null;
  overlapCategories?: CrimeCategory[];
  geocodedOnly?: boolean;
  weaponType?: string | null;
  drugType?: string | null;
  pipelineRun?: string | null;
  bundesland?: string | null;
}

export async function countRecords(opts: CountOptions): Promise<number> {
  // Drug type requires fetching rows, so handle specially
  if (opts.drugType) {
    const rows = await fetchAllRows<{ drug_type: string | null }>((from, to) => {
      let q = supabase
        .from('crime_records')
        .select('drug_type', { count: 'exact' });
      q = applyBaseFilters(q, opts);
      if (opts.overlapCategories && opts.overlapCategories.length > 0) {
        q = q.overlaps('categories', opts.overlapCategories);
      }
      if (opts.geocodedOnly) {
        q = q.not('latitude', 'is', null).not('longitude', 'is', null);
      }
      return q.range(from, to);
    });
    return filterByDrugType(rows, opts.drugType).length;
  }

  // No drug filter — use count query
  let q = supabase
    .from('crime_records')
    .select('*', { count: 'exact', head: true });
  q = applyBaseFilters(q, opts);
  if (opts.overlapCategories && opts.overlapCategories.length > 0) {
    q = q.overlaps('categories', opts.overlapCategories);
  }
  if (opts.geocodedOnly) {
    q = q.not('latitude', 'is', null).not('longitude', 'is', null);
  }

  const { count, error } = await q;
  if (error) throw new Error(`countRecords error: ${error.message}`);
  return count ?? 0;
}

// ────────────────────────── City ranking (RPC + fallback) ──────────────────────────

export interface CityRankingRow {
  city: string;
  current_count: number;
  previous_count: number;
}

/**
 * Returns pre-aggregated city counts for current and previous time windows.
 * Uses SQL RPC when no drug filter; falls back to fetchAllRows + JS bucketing otherwise.
 */
export async function getCityRanking(
  currentStartIso: string,
  currentEndIso: string,
  previousStartIso: string,
  previousEndIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<CityRankingRow[]> {
  // Drug filter requires JS normalization — fall back to row-level fetch
  if (drugType) {
    return getCityRankingFallback(
      currentStartIso, currentEndIso, previousStartIso, previousEndIso,
      category, weaponType, drugType, pipelineRun, bundesland,
    );
  }

  return rpc<CityRankingRow[]>('dashboard_city_ranking', {
    p_current_start: currentStartIso,
    p_current_end: currentEndIso,
    p_prev_start: previousStartIso,
    p_prev_end: previousEndIso,
    p_category: category,
    p_weapon: weaponType,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });
}

async function getCityRankingFallback(
  currentStartIso: string,
  currentEndIso: string,
  previousStartIso: string,
  previousEndIso: string,
  category: CrimeCategory | null,
  weaponType: string | null,
  drugType: string | null,
  pipelineRun: string | null,
  bundesland: string | null = null,
): Promise<CityRankingRow[]> {
  const rows = await fetchAllRows<{ city: string; bundesland: string | null; sort_date: string | null; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('city,bundesland,sort_date,drug_type')
        .not('city', 'is', null);
      q = applyBaseFilters(q, { startIso: previousStartIso, endIso: currentEndIso, category, weaponType, pipelineRun, bundesland });
      return q.range(from, to);
    },
  );
  const filtered = filterByDrugType(rows, drugType);

  const currentStartMs = Date.parse(currentStartIso);
  const currentEndMs = Date.parse(currentEndIso);
  const previousStartMs = Date.parse(previousStartIso);
  const previousEndMs = Date.parse(previousEndIso);

  const buckets: Record<string, { current: number; previous: number }> = {};
  for (const row of filtered) {
    if (!row.sort_date) continue;
    const ts = Date.parse(row.sort_date);
    if (Number.isNaN(ts)) continue;
    const normalizedCity = normalizeCityName(row.city, row.bundesland);
    if (!normalizedCity) continue;
    if (!buckets[normalizedCity]) buckets[normalizedCity] = { current: 0, previous: 0 };
    if (ts >= currentStartMs && ts < currentEndMs) buckets[normalizedCity].current += 1;
    else if (ts >= previousStartMs && ts < previousEndMs) buckets[normalizedCity].previous += 1;
  }

  return Object.entries(buckets)
    .map(([city, counts]) => ({
      city,
      current_count: counts.current,
      previous_count: counts.previous,
    }))
    .filter((r) => r.current_count > 0 || r.previous_count > 0);
}

// ────────────────────────── Kreis ranking (RPC + fallback) ──────────────────────────

export interface KreisRankingRow {
  kreis_ags: string;
  kreis_name: string;
  current_count: number;
  previous_count: number;
}

/**
 * Returns pre-aggregated kreis counts for current and previous time windows.
 * Uses SQL RPC when no drug filter; falls back to fetchAllRows + JS bucketing otherwise.
 */
export async function getKreisRanking(
  currentStartIso: string,
  currentEndIso: string,
  previousStartIso: string,
  previousEndIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<KreisRankingRow[]> {
  if (drugType) {
    return getKreisRankingFallback(
      currentStartIso, currentEndIso, previousStartIso, previousEndIso,
      category, weaponType, drugType, pipelineRun, bundesland,
    );
  }

  return rpc<KreisRankingRow[]>('dashboard_kreis_ranking', {
    p_current_start: currentStartIso,
    p_current_end: currentEndIso,
    p_prev_start: previousStartIso,
    p_prev_end: previousEndIso,
    p_category: category,
    p_weapon: weaponType,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });
}

async function getKreisRankingFallback(
  currentStartIso: string,
  currentEndIso: string,
  previousStartIso: string,
  previousEndIso: string,
  category: CrimeCategory | null,
  weaponType: string | null,
  drugType: string | null,
  pipelineRun: string | null,
  bundesland: string | null = null,
): Promise<KreisRankingRow[]> {
  const rows = await fetchAllRows<{ kreis_ags: string; kreis_name: string; sort_date: string | null; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('kreis_ags,kreis_name,sort_date,drug_type')
        .not('kreis_ags', 'is', null);
      q = applyBaseFilters(q, { startIso: previousStartIso, endIso: currentEndIso, category, weaponType, pipelineRun, bundesland });
      return q.range(from, to);
    },
  );
  const filtered = filterByDrugType(rows, drugType);

  const currentStartMs = Date.parse(currentStartIso);
  const currentEndMs = Date.parse(currentEndIso);
  const previousStartMs = Date.parse(previousStartIso);
  const previousEndMs = Date.parse(previousEndIso);

  const buckets: Record<string, { name: string; current: number; previous: number }> = {};
  for (const row of filtered) {
    if (!row.sort_date) continue;
    const ts = Date.parse(row.sort_date);
    if (Number.isNaN(ts)) continue;
    if (!buckets[row.kreis_ags]) {
      buckets[row.kreis_ags] = { name: row.kreis_name, current: 0, previous: 0 };
    }
    if (ts >= currentStartMs && ts < currentEndMs) buckets[row.kreis_ags].current += 1;
    else if (ts >= previousStartMs && ts < previousEndMs) buckets[row.kreis_ags].previous += 1;
  }

  return Object.entries(buckets)
    .map(([ags, bucket]) => ({
      kreis_ags: ags,
      kreis_name: bucket.name,
      current_count: bucket.current,
      previous_count: bucket.previous,
    }))
    .filter((r) => r.current_count > 0 || r.previous_count > 0);
}

// ────────────────────────── Geocoded points ──────────────────────────

export async function getGeocodedCityPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  citySet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<Array<{ city: string; lat: number; lon: number }>> {
  if (citySet.size === 0) return [];

  const cityArray = Array.from(citySet);
  const rows = await fetchAllRows<{
    city: string;
    latitude: number;
    longitude: number;
    drug_type: string | null;
  }>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select('city,latitude,longitude,drug_type')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .in('city', cityArray);
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    return q.range(from, to);
  });

  const filtered = filterByDrugType(rows, drugType);

  // Deduplicate by rounding to 2 decimal places (~1km precision)
  const seen = new Set<string>();
  const points: Array<{ city: string; lat: number; lon: number }> = [];
  for (const r of filtered) {
    const key = `${r.city}:${r.latitude.toFixed(2)}:${r.longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ city: r.city, lat: r.latitude, lon: r.longitude });
  }
  return points;
}

export async function getGeocodedKreisPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  kreisSet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<Array<{ kreis_ags: string; lat: number; lon: number }>> {
  if (kreisSet.size === 0) return [];

  const kreisArray = Array.from(kreisSet);
  const rows = await fetchAllRows<{
    kreis_ags: string;
    latitude: number;
    longitude: number;
    drug_type: string | null;
  }>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select('kreis_ags,latitude,longitude,drug_type')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .in('kreis_ags', kreisArray);
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    return q.range(from, to);
  });

  const filtered = filterByDrugType(rows, drugType);

  const seen = new Set<string>();
  const points: Array<{ kreis_ags: string; lat: number; lon: number }> = [];
  for (const r of filtered) {
    const key = `${r.kreis_ags}:${r.latitude.toFixed(2)}:${r.longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ kreis_ags: r.kreis_ags, lat: r.latitude, lon: r.longitude });
  }
  return points;
}

// ────────────────────────── PLZ ranking (JS fallback only) ──────────────────────────

export interface PlzRankingRow {
  plz: string;
  current_count: number;
  previous_count: number;
}

export async function getPlzRanking(
  currentStartIso: string,
  currentEndIso: string,
  previousStartIso: string,
  previousEndIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<PlzRankingRow[]> {
  const rows = await fetchAllRows<{ plz: string; sort_date: string | null; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('plz,sort_date,drug_type')
        .not('plz', 'is', null);
      q = applyBaseFilters(q, { startIso: previousStartIso, endIso: currentEndIso, category, weaponType, pipelineRun, bundesland });
      return q.range(from, to);
    },
  );
  const filtered = filterByDrugType(rows, drugType);

  const currentStartMs = Date.parse(currentStartIso);
  const currentEndMs = Date.parse(currentEndIso);
  const previousStartMs = Date.parse(previousStartIso);
  const previousEndMs = Date.parse(previousEndIso);

  const buckets: Record<string, { current: number; previous: number }> = {};
  for (const row of filtered) {
    if (!row.sort_date) continue;
    const ts = Date.parse(row.sort_date);
    if (Number.isNaN(ts)) continue;
    if (!buckets[row.plz]) buckets[row.plz] = { current: 0, previous: 0 };
    if (ts >= currentStartMs && ts < currentEndMs) buckets[row.plz].current += 1;
    else if (ts >= previousStartMs && ts < previousEndMs) buckets[row.plz].previous += 1;
  }

  return Object.entries(buckets)
    .map(([plz, counts]) => ({
      plz,
      current_count: counts.current,
      previous_count: counts.previous,
    }))
    .filter((r) => r.current_count > 0 || r.previous_count > 0);
}

export async function getGeocodedPlzPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  plzSet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<Array<{ plz: string; lat: number; lon: number }>> {
  if (plzSet.size === 0) return [];

  const plzArray = Array.from(plzSet);
  const rows = await fetchAllRows<{
    plz: string;
    latitude: number;
    longitude: number;
    drug_type: string | null;
  }>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select('plz,latitude,longitude,drug_type')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .not('plz', 'is', null)
      .in('plz', plzArray);
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    return q.range(from, to);
  });

  const filtered = filterByDrugType(rows, drugType);

  const seen = new Set<string>();
  const points: Array<{ plz: string; lat: number; lon: number }> = [];
  for (const r of filtered) {
    const key = `${r.plz}:${r.latitude.toFixed(2)}:${r.longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ plz: r.plz, lat: r.latitude, lon: r.longitude });
  }
  return points;
}

// ────────────────────────── Live Feed ──────────────────────────

export interface LiveFeedItem {
  id: string;
  title: string;
  clean_title: string | null;
  published_at: string;
  location_text: string | null;
  district: string | null;
  city: string | null;
  bundesland: string | null;
  categories: CrimeCategory[];
  severity: string | null;
  confidence: number;
  body: string | null;
  weapon_type: string | null;
  weapon_types: string[];
  drug_type: string | null;
  motive: string | null;
  victim_count: number | null;
  suspect_count: number | null;
  victim_age: string | null;
  suspect_age: string | null;
  victim_gender: string | null;
  suspect_gender: string | null;
  victim_herkunft: string | null;
  suspect_herkunft: string | null;
  damage_amount_eur: number | null;
  incident_date: string | null;
  incident_time: string | null;
  pks_category: string | null;
  source_url: string;
  sort_date: string | null;
  is_cold_case: boolean | null;
  latitude: number | null;
  longitude: number | null;
}

const LIVE_FEED_SELECT = [
  'id', 'title', 'clean_title', 'published_at', 'location_text', 'district', 'city',
  'bundesland', 'categories', 'severity', 'confidence', 'body',
  'weapon_type', 'weapon_types', 'drug_type', 'motive', 'victim_count', 'suspect_count',
  'victim_age', 'suspect_age', 'victim_gender', 'suspect_gender',
  'victim_herkunft', 'suspect_herkunft', 'damage_amount_eur',
  'incident_date', 'incident_time', 'pks_category', 'source_url', 'sort_date',
  'is_cold_case', 'latitude', 'longitude',
].join(',');

export async function getLiveFeed(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  limit: number,
  offset = 0,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  city: string | null = null,
  kreisAgs: string | null = null,
  bundesland: string | null = null,
  plz: string | null = null,
): Promise<{ items: LiveFeedItem[]; total: number }> {
  // ── Feed-specific filters ──
  // Base filters include sort_date (Tatzeit) time window globally.
  // Feed adds cold case exclusion and location filters.
  const applyFeedFilters = (q: QueryBuilder) => {
    let fq = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    fq = fq.or('is_cold_case.is.null,is_cold_case.eq.false');
    if (city) fq = fq.eq('city', city);
    if (kreisAgs) fq = fq.eq('kreis_ags', kreisAgs);
    if (plz) fq = fq.eq('plz', plz);
    return fq;
  };

  // When drug filter is active, we need to fetch all rows, filter, then paginate
  if (drugType) {
    const allRows = await fetchAllRows<LiveFeedItem & { drug_type: string | null }>(
      (from, to) => {
        let q = supabase
          .from('crime_records')
          .select(LIVE_FEED_SELECT)
          .order('sort_date', { ascending: false })
          .order('incident_time', { ascending: false, nullsFirst: false });
        q = applyFeedFilters(q);
        return q.range(from, to);
      },
    );
    const filtered = filterByDrugType(allRows, drugType);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  // Count query
  let countQ = supabase
    .from('crime_records')
    .select('*', { count: 'exact', head: true });
  countQ = applyFeedFilters(countQ);
  const { count, error: countErr } = await countQ;
  if (countErr) throw new Error(`getLiveFeed count error: ${countErr.message}`);

  // Data query — sorted by Tatzeit descending (latest first), then by time (nulls at end)
  let dataQ = supabase
    .from('crime_records')
    .select(LIVE_FEED_SELECT)
    .order('sort_date', { ascending: false })
    .order('incident_time', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  dataQ = applyFeedFilters(dataQ);
  const { data, error } = await dataQ;
  if (error) throw new Error(`getLiveFeed data error: ${error.message}`);

  return {
    items: (data ?? []) as LiveFeedItem[],
    total: count ?? 0,
  };
}

// ────────────────────────── Context Stats (RPC + fallback) ──────────────────────────

export interface ContextStatMetric {
  value: string;
  helper: string;
}

export interface ContextStatMetric {
  label: string;
  value: string;
  helper: string;
}

export interface ContextStats {
  suspectProfile: ContextStatMetric[];
  victimProfile: ContextStatMetric[];
  modusOperandi: ContextStatMetric[];
  sceneTime: ContextStatMetric[];
  damageReport: ContextStatMetric[];
  herkunft: ContextStatMetric[];
  peakTime?: { band: string; pct: number };
}

const TIME_BANDS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'] as const;

/** Minimum data points required before showing a stat — prevents misleading small-N percentages */
const MIN_SAMPLE = 3;

const WEAPON_LABELS: Record<string, string> = {
  knife: 'Messer', gun: 'Schusswaffe', blunt: 'Schlagwaffe', explosive: 'Sprengstoff', pepper_spray: 'Pfefferspray',
};
const MOTIVE_LABELS: Record<string, string> = {
  robbery: 'Raub', dispute: 'Streit', road_rage: 'Verkehrskonflikt', drugs: 'Drogen', domestic: 'Häuslich', hate: 'Hass',
};
const DRUG_LABELS: Record<string, string> = {
  cannabis: 'Cannabis', cocaine: 'Kokain', heroin: 'Heroin', amphetamine: 'Amphetamin', ecstasy: 'Ecstasy', meth: 'Crystal Meth', other: 'Sonstige',
};
const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Leicht', serious: 'Schwer', critical: 'Lebensgefährlich', fatal: 'Tödlich', property_only: 'Sachschaden',
};

function topEntry(counts: Record<string, number>, total: number): { value: string; pct: number } | null {
  let best = '';
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  if (!best || bestCount === 0) return null;
  return { value: best, pct: Math.round((bestCount / total) * 100) };
}

function buildProfileMetric(
  ages: number[],
  genders: Record<string, number>,
  genderTotal: number,
): { value: string; helper: string } | null {
  if (ages.length === 0 && genderTotal === 0) return null;
  const avgAge = ages.length > 0
    ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
    : null;
  const genderTop = topEntry(genders, genderTotal);
  const genderLabel = genderTop
    ? `${genderTop.pct}% ${genderTop.value === 'male' ? 'männl.' : genderTop.value === 'female' ? 'weibl.' : genderTop.value}`
    : null;
  return {
    value: avgAge != null ? `Ø ${avgAge} J.` : (genderLabel ?? '–'),
    helper: avgAge != null && genderLabel ? genderLabel : `${ages.length + genderTotal} Angaben`,
  };
}

/**
 * Get context stats using RPC when no drug filter, fallback otherwise.
 */
export async function getContextStats(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<ContextStats> {
  // Drug filter requires JS normalization — fall back to row-level fetch
  if (drugType) {
    return getContextStatsFallback(startIso, endIso, category, weaponType, drugType, pipelineRun, bundesland);
  }

  interface ContextStatsRaw {
    time_buckets: number[];
    weapon_counts: Record<string, number>;
    motive_counts: Record<string, number>;
    damage_sum: number;
    damage_count: number;
    suspect_genders: Record<string, number>;
    victim_genders: Record<string, number>;
    suspect_ages: string[];
    victim_ages: string[];
    drug_type_counts: Record<string, number>;
    suspect_herkunft_counts?: Record<string, number>;
    victim_herkunft_counts?: Record<string, number>;
    location_hint_counts?: Record<string, number>;
    severity_counts?: Record<string, number>;
    suspect_count_sum?: number;
    suspect_count_cases?: number;
    suspect_solo_count?: number;
    victim_count_sum?: number;
    victim_count_cases?: number;
  }

  const stats = await rpc<ContextStatsRaw>('dashboard_context_stats', {
    p_start: startIso,
    p_end: endIso,
    p_category: category,
    p_weapon: weaponType,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });

  // 1. Scene & Time (sceneTime)
  const sceneTime: ContextStatMetric[] = [];
  const timeBuckets = stats.time_buckets ?? [0, 0, 0, 0, 0, 0];
  const timeTotal = timeBuckets.reduce((a, b) => a + b, 0);
  let peakTime: { band: string; pct: number } | undefined;
  if (timeTotal > 0) {
    let peakIdx = 0;
    for (let i = 1; i < 6; i++) {
      if (timeBuckets[i] > timeBuckets[peakIdx]) peakIdx = i;
    }
    const peakPct = Math.round((timeBuckets[peakIdx] / timeTotal) * 100);
    peakTime = { band: TIME_BANDS[peakIdx], pct: peakPct };
    sceneTime.push({
      label: 'Tatzeit',
      value: `${TIME_BANDS[peakIdx]} Uhr`,
      helper: `${peakPct}% d. F.`,
    });
  }

  const locationCounts = stats.location_hint_counts ?? {};
  const locationTotal = Object.values(locationCounts).reduce((a, b) => a + b, 0);
  const locationTop = topEntry(locationCounts, locationTotal);
  if (locationTop && locationTotal >= MIN_SAMPLE) {
    sceneTime.push({
      label: 'Häufiger Tatort',
      value: locationTop.value,
      helper: `${locationTop.pct}% d. F.`,
    });
  }

  // 2. Herkunft (top 3 nationalities from suspect_herkunft_counts)
  const herkunft: ContextStatMetric[] = [];
  const herkunftCounts = stats.suspect_herkunft_counts ?? {};
  const herkunftTotal = Object.values(herkunftCounts).reduce((a, b) => a + b, 0);
  if (herkunftTotal >= MIN_SAMPLE) {
    const sorted = Object.entries(herkunftCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [nationality, count] of sorted) {
      herkunft.push({
        label: nationality,
        value: count.toLocaleString('de-DE'),
        helper: `${Math.round((count / herkunftTotal) * 100)}%`,
      });
    }
  }

  // 3. Suspect Profile (suspectProfile) — Herkunft moved to its own card
  const suspectProfile: ContextStatMetric[] = [];

  const suspectAges: number[] = [];
  for (const ageStr of (stats.suspect_ages ?? [])) suspectAges.push(...parseAges(ageStr));
  const suspectGenderTotal = Object.values(stats.suspect_genders ?? {}).reduce((a, b) => a + b, 0);
  const suspectDemographics = buildProfileMetric(suspectAges, stats.suspect_genders ?? {}, suspectGenderTotal);
  if (suspectDemographics && (suspectAges.length >= MIN_SAMPLE || suspectGenderTotal >= MIN_SAMPLE)) {
    suspectProfile.push({ label: 'Demographie', value: suspectDemographics.value, helper: suspectDemographics.helper });
  }

  // Einzeltäter vs. Gruppe
  const soloCount = stats.suspect_solo_count ?? 0;
  const soloCases = stats.suspect_count_cases ?? 0;
  if (soloCases >= MIN_SAMPLE) {
    const soloPct = Math.round((soloCount / soloCases) * 100);
    suspectProfile.push({ label: 'Einzeltäter', value: `${soloPct}%`, helper: `${soloCount} Fälle` });
  }

  if (stats.suspect_count_cases && stats.suspect_count_sum && stats.suspect_count_cases >= MIN_SAMPLE) {
    const avgSuspects = (stats.suspect_count_sum / stats.suspect_count_cases).toFixed(1);
    const val = avgSuspects.endsWith('.0') ? avgSuspects.slice(0, -2) : avgSuspects;
    suspectProfile.push({ label: 'Gruppengröße', value: `Ø ${val} Pers.`, helper: `${stats.suspect_count_cases} Fälle` });
  }

  // 3. Victim Profile (victimProfile)
  const victimProfile: ContextStatMetric[] = [];
  const victimAges: number[] = [];
  for (const ageStr of (stats.victim_ages ?? [])) victimAges.push(...parseAges(ageStr));
  const victimGenderTotal = Object.values(stats.victim_genders ?? {}).reduce((a, b) => a + b, 0);
  const victimDemographics = buildProfileMetric(victimAges, stats.victim_genders ?? {}, victimGenderTotal);
  if (victimDemographics && (victimAges.length >= MIN_SAMPLE || victimGenderTotal >= MIN_SAMPLE)) {
    victimProfile.push({ label: 'Demographie', value: victimDemographics.value, helper: victimDemographics.helper });
  }

  const severityTotal = Object.values(stats.severity_counts ?? {}).reduce((a, b) => a + b, 0);
  const severityTop = topEntry(stats.severity_counts ?? {}, severityTotal);
  if (severityTop && severityTotal >= MIN_SAMPLE) {
    victimProfile.push({ label: 'Verletzung', value: SEVERITY_LABELS[severityTop.value] ?? severityTop.value, helper: `${severityTop.pct}%` });
  }

  const victimHerkunftTotal = Object.values(stats.victim_herkunft_counts ?? {}).reduce((a, b) => a + b, 0);
  const victimHerkunftTop = topEntry(stats.victim_herkunft_counts ?? {}, victimHerkunftTotal);
  if (victimHerkunftTop && victimHerkunftTotal >= MIN_SAMPLE) {
    victimProfile.push({ label: 'Herkunft', value: victimHerkunftTop.value, helper: `${victimHerkunftTop.pct}%` });
  }

  // 4. Modus Operandi
  const modusOperandi: ContextStatMetric[] = [];
  const weaponTotal = Object.values(stats.weapon_counts ?? {}).reduce((a, b) => a + b, 0);
  const weaponTop = topEntry(stats.weapon_counts ?? {}, weaponTotal);
  if (weaponTop && weaponTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Tatmittel', value: WEAPON_LABELS[weaponTop.value] ?? weaponTop.value, helper: `${weaponTop.pct}%` });
  }

  const motiveTotal = Object.values(stats.motive_counts ?? {}).reduce((a, b) => a + b, 0);
  const motiveTop = topEntry(stats.motive_counts ?? {}, motiveTotal);
  if (motiveTop && motiveTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Motiv', value: MOTIVE_LABELS[motiveTop.value] ?? motiveTop.value, helper: `${motiveTop.pct}%` });
  }

  let drugTotal = 0;
  const normalizedDrugCounts: Record<string, number> = {};
  for (const [rawDrugType, count] of Object.entries(stats.drug_type_counts ?? {})) {
    const drugTypes = extractDrugTypes(rawDrugType);
    for (const dt of drugTypes) {
      if (dt !== 'other') {
        normalizedDrugCounts[dt] = (normalizedDrugCounts[dt] ?? 0) + count;
        drugTotal += count;
      }
    }
  }
  const drugTop = topEntry(normalizedDrugCounts, drugTotal);
  if (drugTop && drugTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Milieu', value: DRUG_LABELS[drugTop.value] ?? drugTop.value, helper: `${drugTop.pct}% (Droge)` });
  }

  // 5. Damage Report (damageReport)
  const damageReport: ContextStatMetric[] = [];
  const damageCount = stats.damage_count ?? 0;
  const damageSum = stats.damage_sum ?? 0;
  if (damageCount >= MIN_SAMPLE) {
    damageReport.push({
      label: 'Durchschnitt',
      value: damageSum / damageCount >= 1000 ? `${(damageSum / damageCount / 1000).toFixed(1)}k €` : `${Math.round(damageSum / damageCount).toLocaleString('de-DE')} €`,
      helper: `${damageCount} Fälle`,
    });
  }
  // Reuse location logic for damage if property crime/vandalism/burglary
  if (locationTop && locationTotal >= MIN_SAMPLE && (category === 'burglary' || category === 'vandalism' || category === 'arson')) {
    damageReport.push({ label: 'Oft betroffen', value: locationTop.value, helper: `${locationTop.pct}%` });
  }

  return { suspectProfile, victimProfile, modusOperandi, sceneTime, damageReport, herkunft, peakTime };
}

const CONTEXT_STATS_SELECT = [
  'incident_time', 'suspect_age', 'suspect_gender', 'victim_age', 'victim_gender',
  'weapon_type', 'motive', 'damage_amount_eur', 'drug_type',
  'suspect_herkunft', 'victim_herkunft', 'location_hint', 'severity', 'suspect_count', 'victim_count'
].join(',');

async function getContextStatsFallback(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null,
  drugType: string | null,
  pipelineRun: string | null,
  bundesland: string | null = null,
): Promise<ContextStats> {
  interface StatsRow {
    incident_time: string | null;
    suspect_age: string | null;
    suspect_gender: string | null;
    victim_age: string | null;
    victim_gender: string | null;
    weapon_type: string | null;
    motive: string | null;
    damage_amount_eur: number | null;
    drug_type: string | null;
    suspect_herkunft: string | null;
    victim_herkunft: string | null;
    location_hint: string | null;
    severity: string | null;
    suspect_count: number | null;
    victim_count: number | null;
  }

  let rows = await fetchAllRows<StatsRow>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select(CONTEXT_STATS_SELECT);
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    return q.range(from, to);
  });

  rows = filterByDrugType(rows, drugType);

  // 1. Scene & Time
  const sceneTime: ContextStatMetric[] = [];
  const timeBuckets = [0, 0, 0, 0, 0, 0];
  let timeTotal = 0;
  for (const r of rows) {
    if (!r.incident_time) continue;
    const hourMatch = r.incident_time.match(/^(\d{1,2})/);
    if (!hourMatch) continue;
    const hour = parseInt(hourMatch[1]);
    if (hour >= 0 && hour < 24) {
      timeBuckets[Math.floor(hour / 4)]++;
      timeTotal++;
    }
  }
  let peakTime: { band: string; pct: number } | undefined;
  if (timeTotal > 0) {
    let peakIdx = 0;
    for (let i = 1; i < 6; i++) {
      if (timeBuckets[i] > timeBuckets[peakIdx]) peakIdx = i;
    }
    const peakPct = Math.round((timeBuckets[peakIdx] / timeTotal) * 100);
    peakTime = { band: TIME_BANDS[peakIdx], pct: peakPct };
    sceneTime.push({
      label: 'Tatzeit',
      value: `${TIME_BANDS[peakIdx]} Uhr`,
      helper: `${peakPct}% d. F.`,
    });
  }

  const locationCounts: Record<string, number> = {};
  let locationTotal = 0;
  for (const r of rows) {
    if (r.location_hint) {
      locationCounts[r.location_hint] = (locationCounts[r.location_hint] ?? 0) + 1;
      locationTotal++;
    }
  }
  const locationTop = topEntry(locationCounts, locationTotal);
  if (locationTop && locationTotal >= MIN_SAMPLE) {
    sceneTime.push({
      label: 'Häufiger Tatort',
      value: locationTop.value,
      helper: `${locationTop.pct}% d. F.`,
    });
  }

  // 2. Herkunft (top 3 nationalities)
  const herkunft: ContextStatMetric[] = [];
  const suspectHerkunftCounts: Record<string, number> = {};
  let suspectHerkunftTotal = 0;
  for (const r of rows) {
    if (r.suspect_herkunft) {
      suspectHerkunftCounts[r.suspect_herkunft] = (suspectHerkunftCounts[r.suspect_herkunft] ?? 0) + 1;
      suspectHerkunftTotal++;
    }
  }
  if (suspectHerkunftTotal >= MIN_SAMPLE) {
    const sorted = Object.entries(suspectHerkunftCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [nationality, count] of sorted) {
      herkunft.push({
        label: nationality,
        value: count.toLocaleString('de-DE'),
        helper: `${Math.round((count / suspectHerkunftTotal) * 100)}%`,
      });
    }
  }

  // 3. Suspect Profile — Herkunft moved to its own card
  const suspectProfile: ContextStatMetric[] = [];

  const suspectAges: number[] = [];
  const suspectGenders: Record<string, number> = {};
  let suspectGenderTotal = 0;
  let suspectCountSum = 0;
  let suspectCountCases = 0;
  let suspectSoloCount = 0;
  for (const r of rows) {
    if (r.suspect_age) suspectAges.push(...parseAges(r.suspect_age));
    if (r.suspect_gender) {
      suspectGenders[r.suspect_gender] = (suspectGenders[r.suspect_gender] ?? 0) + 1;
      suspectGenderTotal++;
    }
    if (r.suspect_count != null) {
      suspectCountSum += r.suspect_count;
      suspectCountCases++;
      if (r.suspect_count === 1) suspectSoloCount++;
    }
  }
  const suspectDemographics = buildProfileMetric(suspectAges, suspectGenders, suspectGenderTotal);
  if (suspectDemographics && (suspectAges.length >= MIN_SAMPLE || suspectGenderTotal >= MIN_SAMPLE)) {
    suspectProfile.push({ label: 'Demographie', value: suspectDemographics.value, helper: suspectDemographics.helper });
  }
  // Einzeltäter vs. Gruppe
  if (suspectCountCases >= MIN_SAMPLE) {
    const soloPct = Math.round((suspectSoloCount / suspectCountCases) * 100);
    suspectProfile.push({ label: 'Einzeltäter', value: `${soloPct}%`, helper: `${suspectSoloCount} Fälle` });
  }
  if (suspectCountCases >= MIN_SAMPLE) {
    const avgSuspects = (suspectCountSum / suspectCountCases).toFixed(1);
    const val = avgSuspects.endsWith('.0') ? avgSuspects.slice(0, -2) : avgSuspects;
    suspectProfile.push({ label: 'Gruppengröße', value: `Ø ${val} Pers.`, helper: `${suspectCountCases} Fälle` });
  }

  // 3. Victim Profile
  const victimProfile: ContextStatMetric[] = [];
  const victimAges: number[] = [];
  const victimGenders: Record<string, number> = {};
  let victimGenderTotal = 0;
  for (const r of rows) {
    if (r.victim_age) victimAges.push(...parseAges(r.victim_age));
    if (r.victim_gender) {
      victimGenders[r.victim_gender] = (victimGenders[r.victim_gender] ?? 0) + 1;
      victimGenderTotal++;
    }
  }
  const victimDemographics = buildProfileMetric(victimAges, victimGenders, victimGenderTotal);
  if (victimDemographics && (victimAges.length >= MIN_SAMPLE || victimGenderTotal >= MIN_SAMPLE)) {
    victimProfile.push({ label: 'Demographie', value: victimDemographics.value, helper: victimDemographics.helper });
  }

  const severityCounts: Record<string, number> = {};
  let severityTotal = 0;
  for (const r of rows) {
    if (r.severity && r.severity !== 'unknown') {
      severityCounts[r.severity] = (severityCounts[r.severity] ?? 0) + 1;
      severityTotal++;
    }
  }
  const severityTop = topEntry(severityCounts, severityTotal);
  if (severityTop && severityTotal >= MIN_SAMPLE) {
    victimProfile.push({ label: 'Verletzung', value: SEVERITY_LABELS[severityTop.value] ?? severityTop.value, helper: `${severityTop.pct}%` });
  }

  const victimHerkunftCounts: Record<string, number> = {};
  let victimHerkunftTotal = 0;
  for (const r of rows) {
    if (r.victim_herkunft) {
      victimHerkunftCounts[r.victim_herkunft] = (victimHerkunftCounts[r.victim_herkunft] ?? 0) + 1;
      victimHerkunftTotal++;
    }
  }
  const victimHerkunftTop = topEntry(victimHerkunftCounts, victimHerkunftTotal);
  if (victimHerkunftTop && victimHerkunftTotal >= MIN_SAMPLE) {
    victimProfile.push({ label: 'Herkunft', value: victimHerkunftTop.value, helper: `${victimHerkunftTop.pct}%` });
  }

  // 4. Modus Operandi
  const modusOperandi: ContextStatMetric[] = [];
  const weaponCounts: Record<string, number> = {};
  let weaponTotal = 0;
  for (const r of rows) {
    if (r.weapon_type && r.weapon_type !== 'unknown' && r.weapon_type !== 'none' && r.weapon_type !== 'vehicle') {
      weaponCounts[r.weapon_type] = (weaponCounts[r.weapon_type] ?? 0) + 1;
      weaponTotal++;
    }
  }
  const weaponTop = topEntry(weaponCounts, weaponTotal);
  if (weaponTop && weaponTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Tatmittel', value: WEAPON_LABELS[weaponTop.value] ?? weaponTop.value, helper: `${weaponTop.pct}%` });
  }

  const motiveCounts: Record<string, number> = {};
  let motiveTotal = 0;
  for (const r of rows) {
    if (r.motive && r.motive !== 'unknown') {
      motiveCounts[r.motive] = (motiveCounts[r.motive] ?? 0) + 1;
      motiveTotal++;
    }
  }
  const motiveTop = topEntry(motiveCounts, motiveTotal);
  if (motiveTop && motiveTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Motiv', value: MOTIVE_LABELS[motiveTop.value] ?? motiveTop.value, helper: `${motiveTop.pct}%` });
  }

  const drugCounts: Record<string, number> = {};
  let drugTotal = 0;
  for (const r of rows) {
    const drugTypes = extractDrugTypes(r.drug_type);
    for (const dt of drugTypes) {
      if (dt !== 'other') {
        drugCounts[dt] = (drugCounts[dt] ?? 0) + 1;
        drugTotal++;
      }
    }
  }
  const drugTop = topEntry(drugCounts, drugTotal);
  if (drugTop && drugTotal >= MIN_SAMPLE) {
    modusOperandi.push({ label: 'Milieu', value: DRUG_LABELS[drugTop.value] ?? drugTop.value, helper: `${drugTop.pct}% (Droge)` });
  }

  // 5. Damage Report
  const damageReport: ContextStatMetric[] = [];
  let damageSum = 0;
  let damageCount = 0;
  for (const r of rows) {
    if (r.damage_amount_eur != null && r.damage_amount_eur > 0) {
      damageSum += r.damage_amount_eur;
      damageCount++;
    }
  }
  if (damageCount >= MIN_SAMPLE) {
    damageReport.push({
      label: 'Durchschnitt',
      value: damageSum / damageCount >= 1000 ? `${(damageSum / damageCount / 1000).toFixed(1)}k €` : `${Math.round(damageSum / damageCount).toLocaleString('de-DE')} €`,
      helper: `${damageCount} Fälle`,
    });
  }
  if (locationTop && locationTotal >= MIN_SAMPLE && (category === 'burglary' || category === 'vandalism' || category === 'arson')) {
    damageReport.push({ label: 'Oft betroffen', value: locationTop.value, helper: `${locationTop.pct}%` });
  }

  return { suspectProfile, victimProfile, modusOperandi, sceneTime, damageReport, herkunft, peakTime };
}

// ────────────────────────── Weapon & Drug counts (RPC) ──────────────────────────

/**
 * Get weapon type counts using SQL GROUP BY via RPC.
 */
export async function getWeaponCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<Record<string, number>> {
  const rows = await rpc<Array<{ weapon_type: string; count: number }>>('dashboard_weapon_counts', {
    p_start: startIso,
    p_end: endIso,
    p_category: category,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });

  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    counts[row.weapon_type] = Number(row.count);
  }
  return counts;
}

/**
 * Get drug type counts using SQL GROUP BY via RPC + JS normalization.
 */
export async function getDrugCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  pipelineRun: string | null = null,
  bundesland: string | null = null,
): Promise<Record<string, number>> {
  const rows = await rpc<Array<{ drug_type: string; count: number }>>('dashboard_drug_counts_raw', {
    p_start: startIso,
    p_end: endIso,
    p_category: category,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });

  // Normalize raw drug_type values via extractDrugTypes
  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    const drugTypes = extractDrugTypes(row.drug_type);
    for (const dt of drugTypes) {
      counts[dt] = (counts[dt] ?? 0) + Number(row.count);
    }
  }
  return counts;
}

/**
 * Get bundesland counts using SQL GROUP BY via RPC.
 */
export async function getBundeslandCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  pipelineRun: string | null = null,
): Promise<Record<string, number>> {
  const rows = await rpc<Array<{ bundesland: string; count: number }>>('dashboard_bundesland_counts', {
    p_start: startIso,
    p_end: endIso,
    p_category: category,
    p_pipeline_run: pipelineRun,
  });

  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    counts[row.bundesland] = Number(row.count);
  }
  return counts;
}

// ────────────────────────── Total count ──────────────────────────

export async function getTotalCount(pipelineRun: string | null = null): Promise<number> {
  let q = supabase
    .from('crime_records')
    .select('*', { count: 'exact', head: true });
  q = applyClassificationFilter(q);
  q = applyPipelineRunFilter(q, pipelineRun);

  const { count, error } = await q;
  if (error) throw new Error(`getTotalCount error: ${error.message}`);
  return count ?? 0;
}

// ────────────────────────── Snapshot Counts (consolidated) ──────────────────────────

const SEVERE_CATS: ReadonlySet<string> = new Set(['murder', 'weapons', 'knife', 'sexual']);

export interface SnapshotCounts {
  incidentsCurrent: number;
  incidentsPrevious: number;
  severeCurrent: number;
  severePrevious: number;
  geocodedCurrent: number;
  newLastHour: number;
  focusCount: number;
  totalRecords: number;
  categoryCounts: Record<string, number>;
}

interface SnapshotCountsRaw {
  incidents_current: number;
  incidents_previous: number;
  severe_current: number;
  severe_previous: number;
  geocoded_current: number;
  new_last_hour: number;
  focus_count: number;
  total_records: number;
  cat_murder: number;
  cat_sexual: number;
  cat_assault: number;
  cat_robbery: number;
  cat_burglary: number;
  cat_arson: number;
  cat_vandalism: number;
  cat_fraud: number;
  cat_drugs: number;
  cat_traffic: number;
}

export interface SnapshotCountsOpts {
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
  hourStartIso: string;
  hourEndIso: string;
  category: CrimeCategory | null;
  weaponType: string | null;
  drugType: string | null;
  pipelineRun: string | null;
  bundesland: string | null;
}

/**
 * Get all snapshot counts in a single query.
 * Replaces 18 separate countRecords calls with 1 SQL RPC using FILTER aggregation.
 * Falls back to single-fetch + JS counting when drug filter is active.
 */
export async function getSnapshotCounts(opts: SnapshotCountsOpts): Promise<SnapshotCounts> {
  if (opts.drugType) {
    return getSnapshotCountsWithDrugFilter(opts);
  }

  const raw = await rpc<SnapshotCountsRaw>('dashboard_snapshot_counts', {
    p_start: opts.startIso,
    p_end: opts.endIso,
    p_prev_start: opts.prevStartIso,
    p_prev_end: opts.prevEndIso,
    p_hour_start: opts.hourStartIso,
    p_hour_end: opts.hourEndIso,
    p_category: opts.category,
    p_weapon: opts.weaponType,
    p_pipeline_run: opts.pipelineRun,
    p_bundesland: opts.bundesland,
  });

  return {
    incidentsCurrent: raw.incidents_current,
    incidentsPrevious: raw.incidents_previous,
    severeCurrent: raw.severe_current,
    severePrevious: raw.severe_previous,
    geocodedCurrent: raw.geocoded_current,
    newLastHour: raw.new_last_hour,
    focusCount: raw.focus_count,
    totalRecords: raw.total_records,
    categoryCounts: {
      murder: raw.cat_murder,
      sexual: raw.cat_sexual,
      assault: raw.cat_assault,
      robbery: raw.cat_robbery,
      burglary: raw.cat_burglary,
      arson: raw.cat_arson,
      vandalism: raw.cat_vandalism,
      fraud: raw.cat_fraud,
      drugs: raw.cat_drugs,
      traffic: raw.cat_traffic,
    },
  };
}

/**
 * Fallback: fetch matching rows once, filter by drug type in JS, count everything.
 * Replaces 18 separate fetchAllRows calls with 1.
 */
async function getSnapshotCountsWithDrugFilter(opts: SnapshotCountsOpts): Promise<SnapshotCounts> {
  const minStart = [opts.startIso, opts.prevStartIso, opts.hourStartIso].sort()[0];
  const maxEnd = [opts.endIso, opts.prevEndIso, opts.hourEndIso].sort().reverse()[0];

  const [rows, totalRecords] = await Promise.all([
    fetchAllRows<{
      sort_date: string | null;
      published_at: string;
      categories: CrimeCategory[];
      latitude: number | null;
      drug_type: string | null;
    }>((from, to) => {
      let q = supabase
        .from('crime_records')
        .select('sort_date,published_at,categories,latitude,drug_type');
      q = applyBaseFilters(q, {
        startIso: minStart,
        endIso: maxEnd,
        weaponType: opts.weaponType,
        pipelineRun: opts.pipelineRun,
        bundesland: opts.bundesland,
      });
      return q.range(from, to);
    }),
    getTotalCount(opts.pipelineRun),
  ]);

  const filtered = filterByDrugType(rows, opts.drugType);

  let incidentsCurrent = 0;
  let incidentsPrevious = 0;
  let severeCurrent = 0;
  let severePrevious = 0;
  let geocodedCurrent = 0;
  let newLastHour = 0;
  let focusCount = 0;
  const catCounts: Record<string, number> = {};

  for (const row of filtered) {
    const sd = row.sort_date ?? row.published_at;
    const inCurrent = sd >= opts.startIso && sd < opts.endIso;
    const inPrevious = sd >= opts.prevStartIso && sd < opts.prevEndIso;
    // new_last_hour uses published_at (publication time) — sort_date is date-only
    const inHour = row.published_at >= opts.hourStartIso && row.published_at < opts.hourEndIso;
    const isSevere = row.categories.some((c) => SEVERE_CATS.has(c));

    if (inCurrent) {
      incidentsCurrent++;
      if (isSevere) severeCurrent++;
      if (row.latitude != null) geocodedCurrent++;
      if (opts.category && row.categories.includes(opts.category)) focusCount++;
      for (const cat of row.categories) {
        catCounts[cat] = (catCounts[cat] ?? 0) + 1;
      }
    }
    if (inPrevious) {
      incidentsPrevious++;
      if (isSevere) severePrevious++;
    }
    if (inHour) newLastHour++;
  }

  return {
    incidentsCurrent,
    incidentsPrevious,
    severeCurrent,
    severePrevious,
    geocodedCurrent,
    newLastHour,
    focusCount: opts.category ? focusCount : incidentsCurrent,
    totalRecords,
    categoryCounts: catCounts,
  };
}
