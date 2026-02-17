/**
 * Server-side Supabase queries for the dashboard API.
 *
 * Replaces the local-enriched-data.ts module with live DB queries.
 * All functions use the anon-key client (RLS allows public reads).
 */

import { supabase } from './client';
import type { CrimeCategory } from '@/lib/types/crime';
import { extractDrugTypes, hasSelectedDrugType } from '@/lib/utils/drug-parser';
import { parseAges } from '@/lib/utils/age-parser';

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

type QueryBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>;

function applyBaseFilters(
  query: QueryBuilder,
  opts: {
    startIso?: string;
    endIso?: string;
    category?: CrimeCategory | null;
    weaponType?: string | null;
    pipelineRun?: string | null;
  },
): QueryBuilder {
  let q = applyClassificationFilter(query);
  if (opts.startIso && opts.endIso) {
    q = applyTimeFilter(q, opts.startIso, opts.endIso);
  }
  q = applyCategoryFilter(q, opts.category ?? null);
  q = applyWeaponFilter(q, opts.weaponType ?? null);
  q = applyPipelineRunFilter(q, opts.pipelineRun ?? null);
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

export async function getCityRows(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
): Promise<Array<{ city: string; published_at: string; drug_type: string | null }>> {
  const rows = await fetchAllRows<{ city: string; published_at: string; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('city,published_at,drug_type')
        .not('city', 'is', null);
      q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
      return q.range(from, to);
    },
  );
  return filterByDrugType(rows, drugType);
}

export async function getKreisRows(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
): Promise<Array<{ kreis_ags: string; kreis_name: string; published_at: string; drug_type: string | null }>> {
  const rows = await fetchAllRows<{ kreis_ags: string; kreis_name: string; published_at: string; drug_type: string | null }>(
    (from, to) => {
      let q = supabase
        .from('crime_records')
        .select('kreis_ags,kreis_name,published_at,drug_type')
        .not('kreis_ags', 'is', null);
      q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
      return q.range(from, to);
    },
  );
  return filterByDrugType(rows, drugType);
}

export async function getGeocodedCityPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  citySet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
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
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
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
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
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

export interface LiveFeedItem {
  id: string;
  title: string;
  clean_title: string | null;
  published_at: string;
  location_text: string | null;
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
  'id', 'title', 'clean_title', 'published_at', 'location_text', 'city',
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
): Promise<{ items: LiveFeedItem[]; total: number }> {
  // When drug filter is active, we need to fetch all rows, filter, then paginate
  if (drugType) {
    const allRows = await fetchAllRows<LiveFeedItem & { drug_type: string | null }>(
      (from, to) => {
        let q = supabase
          .from('crime_records')
          .select(LIVE_FEED_SELECT)
          .order('published_at', { ascending: false });
        q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
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
  countQ = applyBaseFilters(countQ, { startIso, endIso, category, weaponType, pipelineRun });
  const { count, error: countErr } = await countQ;
  if (countErr) throw new Error(`getLiveFeed count error: ${countErr.message}`);

  // Data query
  let dataQ = supabase
    .from('crime_records')
    .select(LIVE_FEED_SELECT)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);
  dataQ = applyBaseFilters(dataQ, { startIso, endIso, category, weaponType, pipelineRun });
  const { data, error } = await dataQ;
  if (error) throw new Error(`getLiveFeed data error: ${error.message}`);

  return {
    items: (data ?? []) as LiveFeedItem[],
    total: count ?? 0,
  };
}

// ────────────────────────── Context Stats ──────────────────────────

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

const CONTEXT_STATS_SELECT = [
  'incident_time', 'suspect_age', 'suspect_gender', 'victim_age', 'victim_gender',
  'weapon_type', 'motive', 'damage_amount_eur', 'drug_type',
].join(',');

export async function getContextStats(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
  pipelineRun: string | null = null,
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
    q = applyBaseFilters(q, { startIso, endIso, category, weaponType, pipelineRun });
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
  let suspectProfile: ContextStatMetric | null = null;
  if (suspectAges.length > 0 || suspectGenderTotal > 0) {
    const avgAge = suspectAges.length > 0
      ? Math.round(suspectAges.reduce((a, b) => a + b, 0) / suspectAges.length)
      : null;
    const genderTop = topEntry(suspectGenders, suspectGenderTotal);
    const genderLabel = genderTop
      ? `${genderTop.pct}% ${genderTop.value === 'male' ? 'männl.' : genderTop.value === 'female' ? 'weibl.' : genderTop.value}`
      : null;
    suspectProfile = {
      value: avgAge != null ? `Ø ${avgAge} J.` : (genderLabel ?? '–'),
      helper: avgAge != null && genderLabel ? genderLabel : `${suspectAges.length + suspectGenderTotal} Angaben`,
    };
  }

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
  let victimProfile: ContextStatMetric | null = null;
  if (victimAges.length > 0 || victimGenderTotal > 0) {
    const avgAge = victimAges.length > 0
      ? Math.round(victimAges.reduce((a, b) => a + b, 0) / victimAges.length)
      : null;
    const genderTop = topEntry(victimGenders, victimGenderTotal);
    const genderLabel = genderTop
      ? `${genderTop.pct}% ${genderTop.value === 'male' ? 'männl.' : genderTop.value === 'female' ? 'weibl.' : genderTop.value}`
      : null;
    victimProfile = {
      value: avgAge != null ? `Ø ${avgAge} J.` : (genderLabel ?? '–'),
      helper: avgAge != null && genderLabel ? genderLabel : `${victimAges.length + victimGenderTotal} Angaben`,
    };
  }

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

// ────────────────────────── Weapon & Drug counts ──────────────────────────

export async function getWeaponCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  pipelineRun: string | null = null,
): Promise<Record<string, number>> {
  const rows = await fetchAllRows<{ weapon_type: string | null }>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select('weapon_type')
      .not('weapon_type', 'is', null);
    q = applyBaseFilters(q, { startIso, endIso, category, pipelineRun });
    return q.range(from, to);
  });

  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.weapon_type && r.weapon_type !== 'none' && r.weapon_type !== 'unknown' && r.weapon_type !== 'vehicle') {
      counts[r.weapon_type] = (counts[r.weapon_type] ?? 0) + 1;
    }
  }
  return counts;
}

export async function getDrugCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  pipelineRun: string | null = null,
): Promise<Record<string, number>> {
  const rows = await fetchAllRows<{ drug_type: string | null }>((from, to) => {
    let q = supabase
      .from('crime_records')
      .select('drug_type')
      .not('drug_type', 'is', null);
    q = applyBaseFilters(q, { startIso, endIso, category, pipelineRun });
    return q.range(from, to);
  });

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const drugTypes = extractDrugTypes(r.drug_type);
    for (const dt of drugTypes) {
      counts[dt] = (counts[dt] ?? 0) + 1;
    }
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
