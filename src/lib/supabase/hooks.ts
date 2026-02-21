import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { fetchCrimeById, fetchCrimeStats, fetchPipelineRuns, fetchAuslaenderByYear, fetchDeutschlandatlas, fetchAllCityCrimes, fetchAllDatasetMeta, fetchDashboardStats, fetchCityRankingByCategory, fetchHotspotKreise, fetchLiveFeed } from './queries';
import { supabase } from './client';
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
 * SWR hook for fetching crime records via the cached server API route.
 *
 * @param category - Optional category filter
 * @param pipelineRun - Optional pipeline run filter
 * @returns SWR response with crimes data, loading state, and error
 */
export function useCrimes(category?: CrimeCategory, pipelineRun?: string) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (pipelineRun) params.set('pipeline_run', pipelineRun);
  const url = `/api/map/crimes${params.toString() ? `?${params}` : ''}`;

  return useSWR<CrimeRecord[], Error>(
    url,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
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

/**
 * SWR hook for full-text search across crime records (title + body).
 * Returns an array of matching crime IDs.
 * Only fires when query is at least 2 characters.
 */
export function useSearchCrimes(query: string) {
  const url = query.length >= 2
    ? `/api/map/crimes/search?q=${encodeURIComponent(query)}`
    : null;

  return useSWR<string[], Error>(
    url,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  );
}

/**
 * Dashboard search: returns results with details (title, date, city, etc.)
 * for rendering a search dropdown on the front page.
 */
export interface DashboardSearchResult {
  id: string;
  title: string;
  clean_title: string | null;
  published_at: string;
  incident_date: string | null;
  incident_time: string | null;
  location_text: string | null;
  city: string | null;
  bundesland: string | null;
  categories: CrimeCategory[];
  source_url: string;
}

interface DashboardSearchResponse {
  total: number;
  results: DashboardSearchResult[];
}

export interface DashboardSearchFilters {
  category?: string | null;
  weapon?: string | null;
  drug?: string | null;
  from?: string | null;
  to?: string | null;
}

export function useDashboardSearch(query: string, filters?: DashboardSearchFilters) {
  const url = (() => {
    if (query.length < 2) return null;
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('detail', '1');
    if (filters?.category) params.set('category', filters.category);
    if (filters?.weapon) params.set('weapon', filters.weapon);
    if (filters?.drug) params.set('drug', filters.drug);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    return `/api/map/crimes/search?${params}`;
  })();

  return useSWR<DashboardSearchResponse, Error>(
    url,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  );
}

export function useSecurityOverview(
  category: CrimeCategory | null,
  timeframe: DashboardTimeframe = DEFAULT_DASHBOARD_TIMEFRAME,
  page = 1,
  weapon: string | null = null,
  drug: string | null = null,
  city: string | null = null,
  kreis: string | null = null,
  bundesland: string | null = null,
  plz: string | null = null,
  fallbackData?: SecurityOverviewResponse,
) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  params.set('timeframe', timeframe);
  if (page > 1) params.set('page', String(page));
  if (weapon) params.set('weapon', weapon);
  if (drug) params.set('drug', drug);
  if (city) params.set('city', city);
  if (kreis) params.set('kreis', kreis);
  if (bundesland) params.set('bundesland', bundesland);
  if (plz) params.set('plz', plz);
  const key = `/api/dashboard/overview${params.toString() ? `?${params}` : ''}`;

  return useSWR<SecurityOverviewResponse, Error>(
    key,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
      keepPreviousData: true,
      fallbackData,
    },
  );
}

/**
 * SWR hook for lazily fetching a single crime record's body text.
 * Only fires when id is non-null.
 */
export function useCrimeBody(id: string | null) {
  return useSWR<string | null, Error>(
    id ? ['crime-body', id] : null,
    async () => {
      const { data, error } = await supabase
        .from('crime_records')
        .select('body')
        .eq('id', id!)
        .single();
      if (error) throw new Error(`useCrimeBody error: ${error.message}`);
      return (data as { body: string | null } | null)?.body ?? null;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000,
    },
  );
}
