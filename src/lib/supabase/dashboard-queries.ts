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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  return query.gte('published_at', startIso).lt('published_at', endIso);
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
    return query.eq('weapon_type', weaponType);
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
  let c = city.trim().replace(/\u2011/g, '-');

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
  const rows = await fetchAllRows<{ city: string; bundesland: string | null; published_at: string; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('city,bundesland,published_at,drug_type')
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
    const ts = Date.parse(row.published_at);
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
  const rows = await fetchAllRows<{ kreis_ags: string; kreis_name: string; published_at: string; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('kreis_ags,kreis_name,published_at,drug_type')
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
    const ts = Date.parse(row.published_at);
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
}

const LIVE_FEED_SELECT = [
  'id', 'title', 'clean_title', 'published_at', 'location_text', 'district', 'city',
  'bundesland', 'categories', 'severity', 'confidence', 'body',
  'weapon_type', 'drug_type', 'motive', 'victim_count', 'suspect_count',
  'victim_age', 'suspect_age', 'victim_gender', 'suspect_gender',
  'victim_herkunft', 'suspect_herkunft', 'damage_amount_eur',
  'incident_date', 'incident_time', 'pks_category', 'source_url',
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
): Promise<{ items: LiveFeedItem[]; total: number }> {
  // When drug filter is active, we need to fetch all rows, filter, then paginate
  if (drugType) {
    const allRows = await fetchAllRows<LiveFeedItem & { drug_type: string | null }>(
      (from, to) => {
        let q = supabase
          .from('crime_records')
          .select(LIVE_FEED_SELECT)
          .order('incident_date', { ascending: false, nullsFirst: false })
          .order('published_at', { ascending: false });
        q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
        if (city) q = q.eq('city', city);
        if (kreisAgs) q = q.eq('kreis_ags', kreisAgs);
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
  countQ = applyBaseFilters(countQ, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
  if (city) countQ = countQ.eq('city', city);
  if (kreisAgs) countQ = countQ.eq('kreis_ags', kreisAgs);
  const { count, error: countErr } = await countQ;
  if (countErr) throw new Error(`getLiveFeed count error: ${countErr.message}`);

  // Data query
  let dataQ = supabase
    .from('crime_records')
    .select(LIVE_FEED_SELECT)
    .order('incident_date', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);
  dataQ = applyBaseFilters(dataQ, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
  if (city) dataQ = dataQ.eq('city', city);
  if (kreisAgs) dataQ = dataQ.eq('kreis_ags', kreisAgs);
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

export interface ContextStats {
  peakTime: ContextStatMetric | null;
  suspectProfile: ContextStatMetric | null;
  victimProfile: ContextStatMetric | null;
  topWeapon: ContextStatMetric | null;
  topMotive: ContextStatMetric | null;
  avgDamage: ContextStatMetric | null;
  topDrug: ContextStatMetric | null;
}

const TIME_BANDS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'] as const;

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
): ContextStatMetric | null {
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
  }

  const stats = await rpc<ContextStatsRaw>('dashboard_context_stats', {
    p_start: startIso,
    p_end: endIso,
    p_category: category,
    p_weapon: weaponType,
    p_pipeline_run: pipelineRun,
    p_bundesland: bundesland,
  });

  // ── peakTime ──
  const timeBuckets = stats.time_buckets ?? [0, 0, 0, 0, 0, 0];
  const timeTotal = timeBuckets.reduce((a, b) => a + b, 0);
  let peakTime: ContextStatMetric | null = null;
  if (timeTotal > 0) {
    let peakIdx = 0;
    for (let i = 1; i < 6; i++) {
      if (timeBuckets[i] > timeBuckets[peakIdx]) peakIdx = i;
    }
    peakTime = {
      value: `${TIME_BANDS[peakIdx]} Uhr`,
      helper: `${Math.round((timeBuckets[peakIdx] / timeTotal) * 100)}% der Fälle`,
    };
  }

  // ── suspectProfile (ages parsed in JS) ──
  const suspectAges: number[] = [];
  for (const ageStr of (stats.suspect_ages ?? [])) {
    suspectAges.push(...parseAges(ageStr));
  }
  const suspectGenderTotal = Object.values(stats.suspect_genders ?? {}).reduce((a, b) => a + b, 0);
  const suspectProfile = buildProfileMetric(suspectAges, stats.suspect_genders ?? {}, suspectGenderTotal);

  // ── victimProfile ──
  const victimAges: number[] = [];
  for (const ageStr of (stats.victim_ages ?? [])) {
    victimAges.push(...parseAges(ageStr));
  }
  const victimGenderTotal = Object.values(stats.victim_genders ?? {}).reduce((a, b) => a + b, 0);
  const victimProfile = buildProfileMetric(victimAges, stats.victim_genders ?? {}, victimGenderTotal);

  // ── topWeapon ──
  const weaponTotal = Object.values(stats.weapon_counts ?? {}).reduce((a, b) => a + b, 0);
  const weaponTop = topEntry(stats.weapon_counts ?? {}, weaponTotal);
  const topWeapon: ContextStatMetric | null = weaponTop
    ? { value: weaponTop.value, helper: `${weaponTop.pct}% der Fälle` }
    : null;

  // ── topMotive ──
  const motiveTotal = Object.values(stats.motive_counts ?? {}).reduce((a, b) => a + b, 0);
  const motiveTop = topEntry(stats.motive_counts ?? {}, motiveTotal);
  const topMotive: ContextStatMetric | null = motiveTop
    ? { value: motiveTop.value, helper: `${motiveTop.pct}% der Fälle` }
    : null;

  // ── avgDamage ──
  const damageCount = stats.damage_count ?? 0;
  const damageSum = stats.damage_sum ?? 0;
  const avgDamage: ContextStatMetric | null = damageCount > 0
    ? {
        value: damageSum / damageCount >= 1000
          ? `${(damageSum / damageCount / 1000).toFixed(1)}k €`
          : `${Math.round(damageSum / damageCount).toLocaleString('de-DE')} €`,
        helper: `${damageCount} Fälle mit Angabe`,
      }
    : null;

  // ── topDrug (normalize raw drug_type counts via extractDrugTypes) ──
  const normalizedDrugCounts: Record<string, number> = {};
  let drugTotal = 0;
  for (const [rawDrugType, count] of Object.entries(stats.drug_type_counts ?? {})) {
    const drugTypes = extractDrugTypes(rawDrugType);
    for (const dt of drugTypes) {
      normalizedDrugCounts[dt] = (normalizedDrugCounts[dt] ?? 0) + count;
      drugTotal += count;
    }
  }
  const drugTop = topEntry(normalizedDrugCounts, drugTotal);
  const topDrug: ContextStatMetric | null = drugTop
    ? { value: drugTop.value, helper: `${drugTop.pct}% der Fälle` }
    : null;

  return { peakTime, suspectProfile, victimProfile, topWeapon, topMotive, avgDamage, topDrug };
}

const CONTEXT_STATS_SELECT = [
  'incident_time', 'suspect_age', 'suspect_gender', 'victim_age', 'victim_gender',
  'weapon_type', 'motive', 'damage_amount_eur', 'drug_type',
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
  }

  let rows = await fetchAllRows<StatsRow>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select(CONTEXT_STATS_SELECT);
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun, bundesland });
    return q.range(from, to);
  });

  rows = filterByDrugType(rows, drugType);

  // ── peakTime ──
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
  let peakTime: ContextStatMetric | null = null;
  if (timeTotal > 0) {
    let peakIdx = 0;
    for (let i = 1; i < 6; i++) {
      if (timeBuckets[i] > timeBuckets[peakIdx]) peakIdx = i;
    }
    peakTime = {
      value: `${TIME_BANDS[peakIdx]} Uhr`,
      helper: `${Math.round((timeBuckets[peakIdx] / timeTotal) * 100)}% der Fälle`,
    };
  }

  // ── suspectProfile ──
  const suspectAges: number[] = [];
  const suspectGenders: Record<string, number> = {};
  let suspectGenderTotal = 0;
  for (const r of rows) {
    if (r.suspect_age) suspectAges.push(...parseAges(r.suspect_age));
    if (r.suspect_gender) {
      suspectGenders[r.suspect_gender] = (suspectGenders[r.suspect_gender] ?? 0) + 1;
      suspectGenderTotal++;
    }
  }
  const suspectProfile = buildProfileMetric(suspectAges, suspectGenders, suspectGenderTotal);

  // ── victimProfile ──
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
  const victimProfile = buildProfileMetric(victimAges, victimGenders, victimGenderTotal);

  // ── topWeapon ──
  const weaponCounts: Record<string, number> = {};
  let weaponTotal = 0;
  for (const r of rows) {
    if (r.weapon_type && r.weapon_type !== 'unknown' && r.weapon_type !== 'none' && r.weapon_type !== 'vehicle') {
      weaponCounts[r.weapon_type] = (weaponCounts[r.weapon_type] ?? 0) + 1;
      weaponTotal++;
    }
  }
  const weaponTop = topEntry(weaponCounts, weaponTotal);
  const topWeapon: ContextStatMetric | null = weaponTop
    ? { value: weaponTop.value, helper: `${weaponTop.pct}% der Fälle` }
    : null;

  // ── topMotive ──
  const motiveCounts: Record<string, number> = {};
  let motiveTotal = 0;
  for (const r of rows) {
    if (r.motive) {
      motiveCounts[r.motive] = (motiveCounts[r.motive] ?? 0) + 1;
      motiveTotal++;
    }
  }
  const motiveTop = topEntry(motiveCounts, motiveTotal);
  const topMotive: ContextStatMetric | null = motiveTop
    ? { value: motiveTop.value, helper: `${motiveTop.pct}% der Fälle` }
    : null;

  // ── avgDamage ──
  let damageSum = 0;
  let damageCount = 0;
  for (const r of rows) {
    if (r.damage_amount_eur != null && r.damage_amount_eur > 0) {
      damageSum += r.damage_amount_eur;
      damageCount++;
    }
  }
  const avgDamage: ContextStatMetric | null = damageCount > 0
    ? {
        value: damageSum / damageCount >= 1000
          ? `${(damageSum / damageCount / 1000).toFixed(1)}k €`
          : `${Math.round(damageSum / damageCount).toLocaleString('de-DE')} €`,
        helper: `${damageCount} Fälle mit Angabe`,
      }
    : null;

  // ── topDrug ──
  const drugCounts: Record<string, number> = {};
  let drugTotal = 0;
  for (const r of rows) {
    const drugTypes = extractDrugTypes(r.drug_type);
    for (const dt of drugTypes) {
      drugCounts[dt] = (drugCounts[dt] ?? 0) + 1;
      drugTotal++;
    }
  }
  const drugTop = topEntry(drugCounts, drugTotal);
  const topDrug: ContextStatMetric | null = drugTop
    ? { value: drugTop.value, helper: `${drugTop.pct}% der Fälle` }
    : null;

  return { peakTime, suspectProfile, victimProfile, topWeapon, topMotive, avgDamage, topDrug };
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
      published_at: string;
      categories: CrimeCategory[];
      latitude: number | null;
      drug_type: string | null;
    }>((from, to) => {
      let q = supabase
        .from('crime_records')
        .select('published_at,categories,latitude,drug_type');
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
    const pa = row.published_at;
    const inCurrent = pa >= opts.startIso && pa < opts.endIso;
    const inPrevious = pa >= opts.prevStartIso && pa < opts.prevEndIso;
    const inHour = pa >= opts.hourStartIso && pa < opts.hourEndIso;
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
