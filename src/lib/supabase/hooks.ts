import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { fetchCrimes, fetchCrimeById, fetchCrimeStats, fetchPipelineRuns, fetchAuslaenderByYear, fetchDeutschlandatlas, fetchAllCityCrimes, fetchAllDatasetMeta, fetchDashboardStats, fetchCityRankingByCategory, fetchHotspotKreise, fetchLiveFeed } from './queries';
import type { CrimeRecord, CrimeCategory } from '../types/crime';
import type { BlaulichtStats, AuslaenderRow, DeutschlandatlasRow, CityCrimeRow, DatasetMetaRow } from './types';
import type { DashboardTimeframe, SecurityOverviewResponse } from '@/lib/dashboard/types';
import { DEFAULT_DASHBOARD_TIMEFRAME } from '@/lib/dashboard/timeframes';

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * SWR hook for fetching crime records with automatic caching and revalidation
 *
 * @param category - Optional category filter
 * @param pipelineRun - Optional pipeline run filter
 * @returns SWR response with crimes data, loading state, and error
 */
export function useCrimes(category?: CrimeCategory, pipelineRun?: string) {
  return useSWR<CrimeRecord[], Error>(
    ['crimes', category ?? 'all', pipelineRun ?? 'all'],
    () => fetchCrimes(category, pipelineRun),
    {
      // Keep data fresh for 5 minutes before revalidating
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Dedupe requests within 1 minute
    }
  );
}

/**
 * SWR hook for fetching a single crime record with all columns (for detail panel).
 * Returns null when no ID is provided. Caches per crime ID.
 */
export function useCrimeDetail(crimeId: string | null) {
  return useSWR<CrimeRecord | null, Error>(
    crimeId ? ['crime-detail', crimeId] : null,
    () => fetchCrimeById(crimeId!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 min — detail data rarely changes
    }
  );
}

/**
 * SWR hook for fetching available pipeline runs with record counts
 */
export function usePipelineRuns() {
  return useSWR<Array<{ run: string; count: number }>, Error>(
    'pipeline-runs',
    fetchPipelineRuns,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );
}

/**
 * SWR hook for fetching crime statistics
 *
 * @returns SWR response with stats data, loading state, and error
 */
export function useCrimeStats() {
  return useSWR<BlaulichtStats, Error>(
    'crime-stats',
    fetchCrimeStats,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );
}

// ============ Indicator Data Hooks ============

/**
 * SWR hook for fetching Ausländer data for a specific year
 * Uses keepPreviousData to prevent flash during year-slider animation
 */
export function useAuslaenderData(year: string) {
  return useSWR<Record<string, AuslaenderRow>, Error>(
    year ? ['auslaender', year] : null,
    () => fetchAuslaenderByYear(year),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 min
      keepPreviousData: true,
    }
  );
}

/**
 * SWR hook for fetching Deutschlandatlas data (single year, all Kreise)
 */
export function useDeutschlandatlasData() {
  return useSWR<Record<string, DeutschlandatlasRow>, Error>(
    'deutschlandatlas',
    fetchDeutschlandatlas,
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 min
    }
  );
}

/**
 * SWR hook for fetching all city crime data across all years
 * Fetches everything upfront for cross-year color scale consistency
 */
export function useCityCrimeData() {
  return useSWR<Record<string, Record<string, CityCrimeRow>>, Error>(
    'city-crimes',
    fetchAllCityCrimes,
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 min
    }
  );
}

/**
 * SWR hook for fetching all dataset metadata (years, sources)
 */
export function useAllDatasetMeta() {
  return useSWR<Record<string, DatasetMetaRow>, Error>(
    'dataset-meta-all',
    fetchAllDatasetMeta,
    {
      revalidateOnFocus: false,
      dedupingInterval: 600000, // 10 min
    }
  );
}

// ============ Dashboard Hooks ============

/**
 * SWR hook for dashboard stats (category + weapon counts)
 * @param timeframeDays - null for all time, or number of days
 */
export function useDashboardStats(timeframeDays: number | null) {
  return useSWR<
    { byCategory: Partial<Record<CrimeCategory, number>>; byWeapon: Record<string, number>; total: number },
    Error
  >(
    ['dashboard-stats', timeframeDays ?? 'all'],
    () => fetchDashboardStats(timeframeDays),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
    }
  );
}

/**
 * SWR hook for city ranking by crime category
 */
export function useCityRanking(category: CrimeCategory, timeframeDays: number | null) {
  return useSWR<Array<{ city: string; count: number }>, Error>(
    ['city-ranking', category, timeframeDays ?? 'all'],
    () => fetchCityRankingByCategory(category, timeframeDays),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
    }
  );
}

/**
 * SWR hook for hotspot Kreise (worst districts by crime rate)
 */
export function useHotspotKreise() {
  return useSWR<Array<{ ags: string; name: string; hz: number }>, Error>(
    'hotspot-kreise',
    () => fetchHotspotKreise(10),
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000,
    }
  );
}

const LIVE_FEED_PAGE_SIZE = 10;

/**
 * SWR Infinite hook for paginated live feed
 */
export function useLiveFeed(categories: CrimeCategory[]) {
  const { data, error, size, setSize, isValidating } = useSWRInfinite<CrimeRecord[], Error>(
    (pageIndex) => ['live-feed', categories.join(','), pageIndex] as const,
    (key) => {
      const pageIndex = key[2] as number;
      return fetchLiveFeed(categories, pageIndex * LIVE_FEED_PAGE_SIZE, LIVE_FEED_PAGE_SIZE);
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  const records = data ? data.flat() : [];
  const isLoadingMore = isValidating && data && typeof data[size - 1] === 'undefined';
  const hasMore = data ? data[data.length - 1]?.length === LIVE_FEED_PAGE_SIZE : false;

  return {
    records,
    error,
    isLoading: !data && !error,
    isLoadingMore,
    hasMore,
    loadMore: () => setSize(size + 1),
  };
}

export function useSecurityOverview(
  category: CrimeCategory | null,
  timeframe: DashboardTimeframe = DEFAULT_DASHBOARD_TIMEFRAME,
  page = 1,
  weapon: string | null = null,
  drug: string | null = null,
) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  params.set('timeframe', timeframe);
  if (page > 1) params.set('page', String(page));
  if (weapon) params.set('weapon', weapon);
  if (drug) params.set('drug', drug);
  const key = `/api/dashboard/overview${params.toString() ? `?${params}` : ''}`;

  return useSWR<SecurityOverviewResponse, Error>(
    key,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
    },
  );
}
