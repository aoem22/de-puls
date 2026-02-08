import useSWR from 'swr';
import { fetchCrimes, fetchCrimeStats, fetchPipelineRuns, fetchAuslaenderByYear, fetchDeutschlandatlas, fetchAllCityCrimes, fetchAllDatasetMeta } from './queries';
import type { CrimeRecord, CrimeCategory } from '../types/crime';
import type { BlaulichtStats, AuslaenderRow, DeutschlandatlasRow, CityCrimeRow, DatasetMetaRow } from './types';

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
