import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow } from '@/lib/supabase';

export interface RankingItem {
  ags: string;
  name: string;
  value: number;
  rank: number;
  percentage: number;
}

interface RankingSourceData {
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  selectedYear: string;
  cityCrimeMetric: 'hz' | 'aq';
  ausData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
}

interface RankingInputItem {
  ags: string;
  name: string;
  value: number;
}

export type RankingDetailRecord = AuslaenderRow | DeutschlandatlasRow | CityCrimeRow;

function finalizeRankings(items: RankingInputItem[]): RankingItem[] {
  if (items.length === 0) return [];

  items.sort((left, right) => right.value - left.value);
  const maxValue = items[0].value;

  return items.map((item, index) => ({
    ...item,
    rank: index + 1,
    percentage: maxValue > 0 ? (item.value / maxValue) * 100 : 0,
  }));
}

function buildAuslaenderItems(subMetric: SubMetricKey, ausData?: Record<string, AuslaenderRow>): RankingInputItem[] {
  if (!ausData) return [];

  const items: RankingInputItem[] = [];
  for (const [ags, record] of Object.entries(ausData)) {
    const value = record.regions[subMetric]?.total;
    if (value !== null && value !== undefined && value > 0) {
      items.push({ ags, name: record.name, value });
    }
  }

  return items;
}

function buildDeutschlandatlasItems(subMetric: SubMetricKey, deutschlandatlasData?: Record<string, DeutschlandatlasRow>): RankingInputItem[] {
  if (!deutschlandatlasData) return [];

  const items: RankingInputItem[] = [];
  for (const [ags, record] of Object.entries(deutschlandatlasData)) {
    const value = record.indicators[subMetric];
    if (value !== null && value !== undefined) {
      items.push({ ags, name: record.name, value });
    }
  }

  return items;
}

function buildCrimeItems(
  subMetric: SubMetricKey,
  selectedYear: string,
  cityCrimeMetric: 'hz' | 'aq',
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>,
): RankingInputItem[] {
  if (!cityCrimeData) return [];

  const yearData = cityCrimeData[selectedYear];
  if (!yearData) return [];

  const items: RankingInputItem[] = [];
  for (const [ags, record] of Object.entries(yearData)) {
    const stats = record.crimes[subMetric];
    if (!stats) continue;
    const value = cityCrimeMetric === 'hz' ? stats.hz : stats.aq;
    if (Number.isFinite(value)) {
      items.push({ ags, name: record.name, value });
    }
  }

  return items;
}

export function buildRankings({
  indicatorKey,
  subMetric,
  selectedYear,
  cityCrimeMetric,
  ausData,
  deutschlandatlasData,
  cityCrimeData,
}: RankingSourceData): RankingItem[] {
  if (indicatorKey === 'auslaender') {
    return finalizeRankings(buildAuslaenderItems(subMetric, ausData));
  }
  if (indicatorKey === 'deutschlandatlas') {
    return finalizeRankings(buildDeutschlandatlasItems(subMetric, deutschlandatlasData));
  }
  if (indicatorKey === 'kriminalstatistik') {
    return finalizeRankings(buildCrimeItems(subMetric, selectedYear, cityCrimeMetric, cityCrimeData));
  }
  return [];
}

interface SelectedRecordInput {
  selectedAgs: string | null;
  indicatorKey: IndicatorKey;
  selectedYear: string;
  ausData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
}

export function getSelectedRecord({
  selectedAgs,
  indicatorKey,
  selectedYear,
  ausData,
  deutschlandatlasData,
  cityCrimeData,
}: SelectedRecordInput): RankingDetailRecord | null {
  if (!selectedAgs) return null;

  if (indicatorKey === 'auslaender') {
    return ausData?.[selectedAgs] ?? null;
  }
  if (indicatorKey === 'deutschlandatlas') {
    return deutschlandatlasData?.[selectedAgs] ?? null;
  }
  return cityCrimeData?.[selectedYear]?.[selectedAgs] ?? null;
}

export function filterRankings(rankings: RankingItem[], searchQuery: string): RankingItem[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return rankings;

  return rankings.filter((item) => (
    item.name.toLowerCase().includes(query)
    || item.ags.toLowerCase().includes(query)
  ));
}

export function getRankingDisplayYear(
  indicatorKey: IndicatorKey,
  selectedYear: string,
  deutschlandatlasYear?: string,
): string {
  if (indicatorKey === 'deutschlandatlas') {
    return deutschlandatlasYear || '2022';
  }
  return selectedYear;
}
