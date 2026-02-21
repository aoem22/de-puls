/**
 * Core dashboard overview builder — shared by the API route (route.ts) and SSR (page.tsx).
 *
 * Extracted from route.ts GET handler so that:
 * 1. The RSC page can call it directly during SSR (avoids self-fetch)
 * 2. The API route delegates to it while keeping cache + HTTP header logic
 *
 * Fix 5: Geo-point queries are chained off their individual ranking promises
 * instead of waiting for ALL of Batch 1 to complete, eliminating the waterfall.
 */

import type { CrimeCategory } from '@/lib/types/crime';
import type { DashboardTimeframe, SecurityOverviewResponse } from '@/lib/dashboard/types';
import {
  DASHBOARD_ALLOWED_TIMEFRAMES,
  DASHBOARD_PREVIOUS_TIMEFRAME_LABELS,
  DASHBOARD_TIMEFRAME_LABELS,
  DASHBOARD_YEAR,
  DEFAULT_DASHBOARD_TIMEFRAME,
  DEFAULT_PIPELINE_RUN,
} from '@/lib/dashboard/timeframes';
import {
  getCityRanking,
  getKreisRanking,
  getPlzRanking,
  getGeocodedCityPoints,
  getGeocodedKreisPoints,
  getGeocodedPlzPoints,
  getLiveFeed,
  getContextStats,
  getWeaponCounts,
  getDrugCounts,
  getBundeslandCounts,
  getSnapshotCounts,
} from '@/lib/supabase/dashboard-queries';

// ────────────────────────── Constants ──────────────────────────

interface TimeWindow {
  timeframe: DashboardTimeframe;
  label: string;
  previousLabel: string;
  startIso: string;
  endIso: string;
  previousStartIso: string;
  previousEndIso: string;
}

const ALLOWED_CATEGORIES: CrimeCategory[] = [
  'murder', 'knife', 'weapons', 'sexual', 'assault', 'robbery',
  'burglary', 'arson', 'drugs', 'fraud', 'vandalism', 'traffic',
  'missing_person', 'other',
];

const SNAPSHOT_CATEGORIES: Array<{ key: CrimeCategory; label: string }> = [
  { key: 'murder', label: 'Mord / Totschlag' },
  { key: 'sexual', label: 'Sexualdelikte' },
  { key: 'assault', label: 'Körperverletzung' },
  { key: 'robbery', label: 'Raub' },
  { key: 'burglary', label: 'Diebstahl / Einbruch' },
  { key: 'arson', label: 'Brandstiftung' },
  { key: 'vandalism', label: 'Sachbeschädigung' },
  { key: 'fraud', label: 'Betrug' },
  { key: 'drugs', label: 'Drogen' },
  { key: 'traffic', label: 'Verkehr' },
];

const DASHBOARD_YEAR_START_ISO = `${DASHBOARD_YEAR}-01-01T00:00:00.000Z`;
const DASHBOARD_YEAR_END_ISO = `${DASHBOARD_YEAR + 1}-01-01T00:00:00.000Z`;
const DASHBOARD_YEAR_START_MS = Date.parse(DASHBOARD_YEAR_START_ISO);
const DASHBOARD_YEAR_END_MS = Date.parse(DASHBOARD_YEAR_END_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_FEED_PAGE_SIZE = 20;

// ────────────────────────── Helpers ──────────────────────────

function calcDeltaPercent(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function isAllowedCategory(raw: string): raw is CrimeCategory {
  return ALLOWED_CATEGORIES.includes(raw as CrimeCategory);
}

function parseTimeframe(raw: string | null): DashboardTimeframe {
  if (!raw) return DEFAULT_DASHBOARD_TIMEFRAME;
  return DASHBOARD_ALLOWED_TIMEFRAMES.includes(raw as DashboardTimeframe)
    ? (raw as DashboardTimeframe)
    : DEFAULT_DASHBOARD_TIMEFRAME;
}

function parsePage(raw: string | null): number {
  return Math.max(1, Number.parseInt(raw ?? '1', 10) || 1);
}

function buildPreviousRankMap<T>(
  rows: T[],
  getKey: (row: T) => string,
  getPreviousCount: (row: T) => number,
): Map<string, number> {
  const ranking = [...rows]
    .filter((row) => getPreviousCount(row) > 0)
    .sort((left, right) => getPreviousCount(right) - getPreviousCount(left));

  const rankMap = new Map<string, number>();
  ranking.forEach((row, index) => rankMap.set(getKey(row), index + 1));
  return rankMap;
}

function addRankChange<T>(
  rows: T[],
  getKey: (row: T) => string,
  previousRankMap: Map<string, number>,
): Array<T & { rankChange: number | null }> {
  return rows.map((row, index) => {
    const currentRank = index + 1;
    const previousRank = previousRankMap.get(getKey(row));
    return {
      ...row,
      rankChange: previousRank != null ? previousRank - currentRank : null,
    };
  });
}

function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfUtcMonth(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addUtcMonths(monthStartMs: number, delta: number): number {
  const date = new Date(monthStartMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1);
}

function startOfUtcIsoWeek(ms: number): number {
  const dayStart = startOfUtcDay(ms);
  const weekday = new Date(dayStart).getUTCDay();
  const offset = (weekday + 6) % 7;
  return dayStart - offset * DAY_MS;
}

function clampWindowToYear(startMs: number, endMs: number): { startIso: string; endIso: string } {
  const clampedStart = Math.max(startMs, DASHBOARD_YEAR_START_MS);
  const clampedEnd = Math.min(endMs, DASHBOARD_YEAR_END_MS);
  const safeEnd = clampedEnd >= clampedStart ? clampedEnd : clampedStart;

  return {
    startIso: new Date(clampedStart).toISOString(),
    endIso: new Date(safeEnd).toISOString(),
  };
}

function buildTimeWindow(timeframe: DashboardTimeframe, anchorMs: number): TimeWindow {
  const dayStart = startOfUtcDay(anchorMs);
  const monthStart = startOfUtcMonth(anchorMs);
  const thisWeekStart = startOfUtcIsoWeek(anchorMs);

  let currentStartMs = dayStart;
  let currentEndMs = dayStart + DAY_MS;
  let previousStartMs = dayStart - DAY_MS;
  let previousEndMs = dayStart;

  switch (timeframe) {
    case 'today':
      currentStartMs = dayStart;
      currentEndMs = dayStart + DAY_MS;
      previousStartMs = dayStart - DAY_MS;
      previousEndMs = dayStart;
      break;
    case 'yesterday':
      currentStartMs = dayStart - DAY_MS;
      currentEndMs = dayStart;
      previousStartMs = dayStart - 2 * DAY_MS;
      previousEndMs = dayStart - DAY_MS;
      break;
    case 'last_week':
      currentStartMs = thisWeekStart - 7 * DAY_MS;
      currentEndMs = thisWeekStart;
      previousStartMs = thisWeekStart - 14 * DAY_MS;
      previousEndMs = thisWeekStart - 7 * DAY_MS;
      break;
    case 'this_month':
      currentStartMs = monthStart;
      currentEndMs = addUtcMonths(monthStart, 1);
      previousStartMs = addUtcMonths(monthStart, -1);
      previousEndMs = monthStart;
      break;
    case 'last_month':
      currentStartMs = addUtcMonths(monthStart, -1);
      currentEndMs = monthStart;
      previousStartMs = addUtcMonths(monthStart, -2);
      previousEndMs = addUtcMonths(monthStart, -1);
      break;
    case 'year_to_date':
      currentStartMs = DASHBOARD_YEAR_START_MS;
      currentEndMs = DASHBOARD_YEAR_END_MS;
      previousStartMs = DASHBOARD_YEAR_START_MS;
      previousEndMs = DASHBOARD_YEAR_START_MS;
      break;
  }

  const current = clampWindowToYear(currentStartMs, currentEndMs);
  const previous = clampWindowToYear(previousStartMs, previousEndMs);

  return {
    timeframe,
    label: DASHBOARD_TIMEFRAME_LABELS[timeframe],
    previousLabel: DASHBOARD_PREVIOUS_TIMEFRAME_LABELS[timeframe],
    startIso: current.startIso,
    endIso: current.endIso,
    previousStartIso: previous.startIso,
    previousEndIso: previous.endIso,
  };
}

// ────────────────────────── Public API ──────────────────────────

export interface BuildOverviewParams {
  category?: string | null;
  timeframe?: string | null;
  page?: string | null;
  weapon?: string | null;
  drug?: string | null;
  pipelineRun?: string | null;
  city?: string | null;
  kreis?: string | null;
  plz?: string | null;
  bundesland?: string | null;
}

/**
 * Build the full SecurityOverviewResponse.
 * Called by both the API route handler and the RSC page for SSR.
 *
 * Returns `{ payload, error }` — caller decides how to serialize / respond.
 */
export async function buildDashboardOverview(
  params: BuildOverviewParams,
): Promise<SecurityOverviewResponse> {
  const categoryParam = params.category ?? null;
  const timeframeParam = params.timeframe ?? null;
  const pageParam = params.page ?? null;
  const weaponParam = params.weapon ?? null;
  const drugParam = params.drug ?? null;
  const pipelineRunParam = params.pipelineRun ?? null;
  const cityParam = params.city ?? null;
  const kreisParam = params.kreis ?? null;
  const plzParam = params.plz ?? null;
  const bundeslandParam = params.bundesland ?? null;

  let category: CrimeCategory | null = null;
  if (categoryParam && categoryParam !== 'all') {
    if (!isAllowedCategory(categoryParam)) {
      throw new Error('Invalid category');
    }
    category = categoryParam;
  }
  const timeframe = parseTimeframe(timeframeParam);
  const page = parsePage(pageParam);
  const weaponFilter = weaponParam && weaponParam !== 'all' ? weaponParam : null;
  const drugFilter = drugParam && drugParam !== 'all' ? drugParam : null;
  const rawPipelineRun = pipelineRunParam || DEFAULT_PIPELINE_RUN;
  const pipelineRun = rawPipelineRun === 'all' ? null : rawPipelineRun;
  const cityFilter = cityParam || null;
  const kreisFilter = kreisParam || null;
  const plzFilter = plzParam || null;
  const bundeslandFilter = bundeslandParam || null;

  const nowMs = Date.now();
  const anchorMs = Math.min(
    Math.max(nowMs, DASHBOARD_YEAR_START_MS),
    DASHBOARD_YEAR_END_MS - 1,
  );

  const window = buildTimeWindow(timeframe, anchorMs);

  const oneHourAgoIso = new Date(anchorMs - 60 * 60 * 1000).toISOString();
  const anchorIso = new Date(anchorMs).toISOString();

  const liveFeedOffset = (page - 1) * LIVE_FEED_PAGE_SIZE;

  // ── Fix 5: Launch ranking queries individually so geo queries chain off them ──
  // Instead of a 2-batch waterfall (rankings → geo points), each geo-point query
  // starts as soon as its corresponding ranking resolves.

  const cityRankingP = getCityRanking(
    window.startIso, window.endIso, window.previousStartIso, window.previousEndIso,
    category, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
  );
  const kreisRankingP = getKreisRanking(
    window.startIso, window.endIso, window.previousStartIso, window.previousEndIso,
    category, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
  );
  const plzRankingP = getPlzRanking(
    window.startIso, window.endIso, window.previousStartIso, window.previousEndIso,
    category, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
  );

  // Geo queries chain off their ranking — start as soon as ranking resolves
  const topCityPointsP = cityRankingP.then((ranking) => {
    const topNames = new Set(
      ranking
        .filter((r) => Number(r.current_count) > 0)
        .sort((a, b) => Number(b.current_count) - Number(a.current_count))
        .slice(0, 15)
        .map((r) => r.city),
    );
    return getGeocodedCityPoints(
      window.startIso, window.endIso, category, topNames, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
    );
  });
  const topKreisPointsP = kreisRankingP.then((ranking) => {
    const topAgs = new Set(
      ranking
        .filter((r) => Number(r.current_count) > 0)
        .sort((a, b) => Number(b.current_count) - Number(a.current_count))
        .slice(0, 15)
        .map((r) => r.kreis_ags),
    );
    return getGeocodedKreisPoints(
      window.startIso, window.endIso, category, topAgs, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
    );
  });
  const topPlzPointsP = plzRankingP.then((ranking) => {
    const topPlzSet = new Set(
      ranking
        .filter((r) => Number(r.current_count) > 0)
        .sort((a, b) => Number(b.current_count) - Number(a.current_count))
        .slice(0, 15)
        .map((r) => r.plz),
    );
    return getGeocodedPlzPoints(
      window.startIso, window.endIso, category, topPlzSet, weaponFilter, drugFilter, pipelineRun, bundeslandFilter,
    );
  });

  // All other queries run in parallel alongside rankings
  const [
    snapshot, contextStats, liveFeedResult, weaponCounts, drugCounts, bundeslandCounts,
    cityRanking, kreisRanking, plzRanking,
    topCityPoints, topKreisPoints, topPlzPoints,
  ] = await Promise.all([
    getSnapshotCounts({
      startIso: window.startIso,
      endIso: window.endIso,
      prevStartIso: window.previousStartIso,
      prevEndIso: window.previousEndIso,
      hourStartIso: oneHourAgoIso,
      hourEndIso: anchorIso,
      category,
      weaponType: weaponFilter,
      drugType: drugFilter,
      pipelineRun,
      bundesland: bundeslandFilter,
    }),
    getContextStats(window.startIso, window.endIso, category, weaponFilter, drugFilter, pipelineRun, bundeslandFilter),
    getLiveFeed(window.startIso, window.endIso, category, LIVE_FEED_PAGE_SIZE, liveFeedOffset, weaponFilter, drugFilter, pipelineRun, cityFilter, kreisFilter, bundeslandFilter, plzFilter),
    getWeaponCounts(window.startIso, window.endIso, category, pipelineRun, bundeslandFilter),
    getDrugCounts(window.startIso, window.endIso, category, pipelineRun, bundeslandFilter),
    getBundeslandCounts(window.startIso, window.endIso, category, pipelineRun),
    // Rankings + chained geo queries — all resolving together
    cityRankingP,
    kreisRankingP,
    plzRankingP,
    topCityPointsP,
    topKreisPointsP,
    topPlzPointsP,
  ]);

  const {
    incidentsCurrent, incidentsPrevious,
    severeCurrent, severePrevious,
    geocodedCurrent, newLastHour,
    focusCount: explicitFocusCount,
    totalRecords: totalRecords2026,
    categoryCounts: snapshotCategoryCounts,
  } = snapshot;

  const focusCountCurrent = category ? explicitFocusCount : incidentsCurrent;

  const categoryCounts = SNAPSHOT_CATEGORIES.map((item) => ({
    ...item,
    count: snapshotCategoryCounts[item.key] ?? 0,
  }));

  const { items: liveFeed, total: liveFeedTotal } = liveFeedResult;

  // ── City ranking ──
  const topCitiesBase = cityRanking
    .filter((row) => Number(row.current_count) > 0)
    .sort((a, b) => Number(b.current_count) - Number(a.current_count))
    .slice(0, 15)
    .map((row) => ({
      city: row.city,
      count: Number(row.current_count),
      previousCount: Number(row.previous_count),
    }));

  const previousCityRankMap = buildPreviousRankMap(
    cityRanking.map((row) => ({ city: row.city, previousCount: Number(row.previous_count) })),
    (row) => row.city,
    (row) => row.previousCount,
  );
  const topCities = addRankChange(topCitiesBase, (row) => row.city, previousCityRankMap);

  // ── Kreis ranking ──
  const topKreiseBase = kreisRanking
    .filter((row) => Number(row.current_count) > 0)
    .sort((a, b) => Number(b.current_count) - Number(a.current_count))
    .slice(0, 15)
    .map((row) => ({
      kreisAgs: row.kreis_ags,
      kreisName: row.kreis_name,
      count: Number(row.current_count),
      previousCount: Number(row.previous_count),
    }));

  const previousKreisRankMap = buildPreviousRankMap(
    kreisRanking.map((row) => ({ kreisAgs: row.kreis_ags, previousCount: Number(row.previous_count) })),
    (row) => row.kreisAgs,
    (row) => row.previousCount,
  );
  const topKreise = addRankChange(topKreiseBase, (row) => row.kreisAgs, previousKreisRankMap);

  // ── PLZ ranking ──
  const topPlzBase = plzRanking
    .filter((row) => Number(row.current_count) > 0)
    .sort((a, b) => Number(b.current_count) - Number(a.current_count))
    .slice(0, 15)
    .map((row) => ({
      plz: row.plz,
      count: Number(row.current_count),
      previousCount: Number(row.previous_count),
    }));

  const previousPlzRankMap = buildPreviousRankMap(
    plzRanking.map((row) => ({ plz: row.plz, previousCount: Number(row.previous_count) })),
    (row) => row.plz,
    (row) => row.previousCount,
  );
  const topPlz = addRankChange(topPlzBase, (row) => row.plz, previousPlzRankMap);

  // ── Anomalies (from pre-aggregated city data) ──
  const anomalies = cityRanking
    .map((row) => ({
      city: row.city,
      current: Number(row.current_count),
      previous: Number(row.previous_count),
      delta: Number(row.current_count) - Number(row.previous_count),
    }))
    .filter((row) => row.current >= 3 && row.delta >= 2)
    .sort((a, b) => b.delta - a.delta || b.current - a.current)
    .slice(0, 8);

  return {
    generatedAt: new Date(anchorMs).toISOString(),
    dataSource: 'supabase crime_records',
    focusCategory: category,
    period: {
      timeframe: window.timeframe,
      label: window.label,
      previousLabel: window.previousLabel,
      startIso: window.startIso,
      endIso: window.endIso,
      previousStartIso: window.previousStartIso,
      previousEndIso: window.previousEndIso,
      scopeYear: DASHBOARD_YEAR,
    },
    snapshot: {
      incidentsCurrent,
      incidentsPrevious,
      severeCurrent,
      severePrevious,
      focusCountCurrent,
      newLastHour,
      geocodedCurrent,
      geocodedRateCurrent: incidentsCurrent > 0 ? geocodedCurrent / incidentsCurrent : 0,
      incidentsTrendPct: calcDeltaPercent(incidentsCurrent, incidentsPrevious),
      severeTrendPct: calcDeltaPercent(severeCurrent, severePrevious),
      totalRecords2026,
    },
    categoryCounts,
    weaponCounts,
    weaponFilter,
    drugCounts,
    drugFilter,
    bundeslandCounts,
    bundeslandFilter,
    topCities,
    topCityPoints,
    topKreise,
    topKreisPoints,
    topPlz,
    topPlzPoints,
    anomalies,
    contextStats,
    liveFeed,
    liveFeedTotal,
    liveFeedPage: page,
    liveFeedPageSize: LIVE_FEED_PAGE_SIZE,
    liveFeedCity: cityFilter,
    liveFeedKreis: kreisFilter,
    liveFeedPlz: plzFilter,
  };
}
