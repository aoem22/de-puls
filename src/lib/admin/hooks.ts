import { useState, useCallback, useRef } from 'react';
import useSWR from 'swr';
import type {
  PipelineStats,
  ChunksResponse,
  AdminComment,
  EnrichmentVersion,
  MetricKey,
  MetricBreakdownResponse,
  EnrichFile,
  EnrichHistory,
  GeocodeHistory,
  ScrapeHistory,
  CompareChunksMetaResponse,
  CompareChunksDetailResponse,
  AvailableMonthsResponse,
} from './types';

// ── Session-persisted state ──────────────────────────────────

/**
 * Like useState, but persists to sessionStorage so values survive
 * tab navigation within the admin panel.
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `admin:${key}`;
  const defaultRef = useRef(defaultValue);

  const [value, setValueRaw] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch { /* ignore parse errors */ }
    return defaultValue;
  });

  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    setValueRaw((prev) => {
      const next = typeof v === 'function' ? (v as (prev: T) => T)(prev) : v;
      try {
        // Clean up if value equals default
        if (JSON.stringify(next) === JSON.stringify(defaultRef.current)) {
          sessionStorage.removeItem(storageKey);
        } else {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        }
      } catch { /* quota exceeded, ignore */ }
      return next;
    });
  }, [storageKey]);

  return [value, setValue];
}

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
});

export function useManifest() {
  return useSWR<PipelineStats, Error>(
    '/api/admin/manifest',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export function useChunks(yearMonth: string | null, bundesland: string | null) {
  const params = new URLSearchParams();
  if (yearMonth) params.set('yearMonth', yearMonth);
  if (bundesland) params.set('bundesland', bundesland);
  const key = yearMonth ? `/api/admin/chunks?${params}` : null;

  return useSWR<ChunksResponse, Error>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );
}

function buildChunksQuery(
  yearMonth: string,
  bundesland: string | null,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ yearMonth });
  if (bundesland) params.set('bundesland', bundesland);
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  return `/api/admin/chunks?${params}`;
}

export function useCompareAvailableMonths() {
  return useSWR<AvailableMonthsResponse, Error>(
    '/api/admin/available-months',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300000 }
  );
}

export interface CompareFilters {
  category?: string;
  subType?: string;
  search?: string;
}

export function useCompareChunksMeta(
  yearMonth: string | null,
  bundesland: string | null,
  filters?: CompareFilters,
) {
  const extra: Record<string, string> = { view: 'meta' };
  if (filters?.category) extra.category = filters.category;
  if (filters?.subType) extra.subType = filters.subType;
  if (filters?.search) extra.search = filters.search;

  const key = yearMonth
    ? buildChunksQuery(yearMonth, bundesland, extra)
    : null;

  return useSWR<CompareChunksMetaResponse, Error>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, keepPreviousData: true }
  );
}

export function useCompareChunkDetail(
  yearMonth: string | null,
  bundesland: string | null,
  index: number,
  filters?: CompareFilters,
) {
  const extra: Record<string, string> = { view: 'detail', index: String(index) };
  if (filters?.category) extra.category = filters.category;
  if (filters?.subType) extra.subType = filters.subType;
  if (filters?.search) extra.search = filters.search;

  const key = yearMonth
    ? buildChunksQuery(yearMonth, bundesland, extra)
    : null;

  return useSWR<CompareChunksDetailResponse, Error>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, keepPreviousData: true }
  );
}

export function useComments(articleUrl?: string) {
  const params = articleUrl ? `?articleUrl=${encodeURIComponent(articleUrl)}` : '';
  return useSWR<AdminComment[], Error>(
    `/api/admin/comments${params}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  );
}

export function useModels() {
  return useSWR<Array<{ id: string; name: string; pricing?: { prompt: string; completion: string } }>, Error>(
    '/api/admin/models',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300000 }
  );
}

export function useEnrichFiles() {
  return useSWR<EnrichFile[], Error>(
    '/api/admin/enrich/files',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export interface PromptConfig {
  model?: string;
  provider?: 'openrouter' | 'deepseek';
  max_tokens?: number;
  temperature?: number;
}

export interface PromptVersion {
  name: string;
  size: number;
  modified: string;
  isActive: boolean;
  config?: PromptConfig | null;
}

export function usePrompts() {
  return useSWR<{ versions: PromptVersion[]; activeVersion: string | null }, Error>(
    '/api/admin/prompts',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  );
}

export function useEnrichmentVersions(articleUrl: string | null) {
  return useSWR<EnrichmentVersion[], Error>(
    articleUrl ? `/api/admin/re-enrich?articleUrl=${encodeURIComponent(articleUrl)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );
}

export function useMetricBreakdown(metric: MetricKey | null) {
  return useSWR<MetricBreakdownResponse, Error>(
    metric ? `/api/admin/metric-breakdown?metric=${metric}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export function useEnrichHistory() {
  return useSWR<EnrichHistory, Error>(
    '/api/admin/enrich/history',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export function useScrapeHistory() {
  return useSWR<ScrapeHistory, Error>(
    '/api/admin/scrape/history',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export function useGeocodeHistory() {
  return useSWR<GeocodeHistory, Error>(
    '/api/admin/geocode/history',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
}

export function usePromptContent(version: string | null) {
  return useSWR<{ version: string; content: string; config?: PromptConfig | null }, Error>(
    version ? `/api/admin/prompts/content?version=${version}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );
}
