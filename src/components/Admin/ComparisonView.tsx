'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  usePersistedState,
  useCompareAvailableMonths,
  useCompareChunksMeta,
  useCompareChunkDetail,
} from '@/lib/admin/hooks';
import type { CompareFilters } from '@/lib/admin/hooks';
import type { PairedArticle, RawArticle, EnrichedArticle } from '@/lib/admin/types';
import { ComparisonToolbar } from './ComparisonToolbar';

const ArticleRawPanel = dynamic(
  () => import('./ArticleRawPanel').then((mod) => mod.ArticleRawPanel),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
        Loading raw article...
      </div>
    ),
  },
);

const ArticleEnrichedPanel = dynamic(
  () => import('./ArticleEnrichedPanel').then((mod) => mod.ArticleEnrichedPanel),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
        Loading enrichment...
      </div>
    ),
  },
);

function normalizeArticle(article: PairedArticle | null): PairedArticle | null {
  if (!article) return null;
  return {
    raw: article.raw ?? ({} as RawArticle),
    enriched: Array.isArray(article.enriched) ? article.enriched : ([] as EnrichedArticle[]),
    cacheEntry: article.cacheEntry ?? null,
  };
}

export function ComparisonView() {
  const [yearMonth, setYearMonth] = usePersistedState('compare.yearMonth', '');
  const [bundesland, setBundesland] = usePersistedState('compare.bundesland', '');
  const [currentIndex, setCurrentIndex] = usePersistedState('compare.index', 0);
  const [category, setCategory] = usePersistedState('compare.category', '');
  const [subType, setSubType] = usePersistedState('compare.subType', '');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce keyword search by 350ms
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const filters: CompareFilters = {
    ...(category && { category }),
    ...(subType && { subType }),
    ...(debouncedSearch && { search: debouncedSearch }),
  };

  const { data: monthsData, isLoading: monthsLoading } = useCompareAvailableMonths();
  const { data: metaData, isLoading: metaLoading, error: metaError } = useCompareChunksMeta(
    yearMonth || null,
    bundesland || null,
    filters,
  );
  const { data: detailData, isLoading: detailLoading, error: detailError } = useCompareChunkDetail(
    yearMonth || null,
    bundesland || null,
    currentIndex,
    filters,
  );

  const total = metaData?.total ?? 0;
  const dataSource = metaData?.dataSource;

  // Initialize month from backend range once available.
  useEffect(() => {
    if (yearMonth) return;
    if (monthsData?.oldest) {
      setYearMonth(monthsData.oldest);
      return;
    }
    if (!monthsLoading) {
      setYearMonth('2026-02');
    }
  }, [yearMonth, monthsData?.oldest, monthsLoading, setYearMonth]);

  // Clear sub-type if it's no longer in the available options (e.g. category changed).
  const availableSubTypes = metaData?.availableSubTypes;
  useEffect(() => {
    if (subType && availableSubTypes && !availableSubTypes.includes(subType)) {
      setSubType('');
    }
  }, [subType, availableSubTypes, setSubType]);

  // Keep index in bounds as the result set changes.
  useEffect(() => {
    if (total === 0) {
      if (currentIndex !== 0) setCurrentIndex(0);
      return;
    }
    if (currentIndex >= total) {
      setCurrentIndex(total - 1);
    }
  }, [currentIndex, total, setCurrentIndex]);

  // Keyboard navigation
  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, [setCurrentIndex]);

  const handleNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(Math.max(total - 1, 0), i + 1));
  }, [setCurrentIndex, total]);

  const handleYearMonthChange = useCallback((ym: string) => {
    setYearMonth(ym);
    setCurrentIndex(0);
  }, [setYearMonth, setCurrentIndex]);

  const handleBundeslandChange = useCallback((bl: string) => {
    setBundesland(bl);
    setCurrentIndex(0);
  }, [setBundesland, setCurrentIndex]);

  const handleCategoryChange = useCallback((cat: string) => {
    setCategory(cat);
    setCurrentIndex(0);
  }, [setCategory, setCurrentIndex]);

  const handleSubTypeChange = useCallback((st: string) => {
    setSubType(st);
    setCurrentIndex(0);
  }, [setSubType, setCurrentIndex]);

  const handleSearchChange = useCallback((q: string) => {
    setSearchInput(q);
    setCurrentIndex(0);
  }, [setCurrentIndex]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePrev, handleNext]);

  const hasCurrentDetail = (detailData?.index ?? -1) === currentIndex;
  const current = hasCurrentDetail
    ? normalizeArticle((detailData?.article ?? null) as PairedArticle | null)
    : null;
  const error = metaError ?? detailError;
  const showInitialLoading = !!yearMonth && !metaData && metaLoading;
  const showDetailLoading = total > 0 && !hasCurrentDetail && !detailError && detailLoading;

  return (
    <div className="flex h-[calc(100vh-theme(spacing.12))] flex-col gap-3">
      <ComparisonToolbar
        yearMonth={yearMonth}
        bundesland={bundesland}
        onYearMonthChange={handleYearMonthChange}
        onBundeslandChange={handleBundeslandChange}
        category={category}
        subType={subType}
        search={searchInput}
        onCategoryChange={handleCategoryChange}
        onSubTypeChange={handleSubTypeChange}
        onSearchChange={handleSearchChange}
        availableSubTypes={metaData?.availableSubTypes}
        currentIndex={currentIndex}
        total={total}
        onJump={setCurrentIndex}
        onPrev={handlePrev}
        onNext={handleNext}
        availableMonths={monthsData?.months}
        dataSource={dataSource}
      />

      {error && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
        >
          Failed to load comparison data: {error.message}
        </div>
      )}

      {showInitialLoading ? (
        <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-faint)' }}>
          Loading chunk data...
        </div>
      ) : total === 0 ? (
        <div className="flex flex-1 items-center justify-center" style={{ color: 'var(--text-faint)' }}>
          No articles found for {yearMonth}
          {bundesland ? ` in ${bundesland}` : ''}
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-hidden">
          {/* Left panel: Raw */}
          <div
            className="flex-1 overflow-hidden rounded-xl border"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--card)',
            }}
          >
            {showDetailLoading ? (
              <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
                Loading article...
              </div>
            ) : (
              <ArticleRawPanel article={current ? current.raw : null} />
            )}
          </div>

          {/* Right panel: Enriched */}
          <div
            className="flex-1 overflow-hidden rounded-xl border"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--card)',
            }}
          >
            {showDetailLoading ? (
              <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
                Loading enrichment...
              </div>
            ) : (
              <ArticleEnrichedPanel
                articles={current?.enriched ?? []}
                cacheEntry={current?.cacheEntry}
                articleUrl={String(current?.raw?.url ?? '')}
                rawArticle={current?.raw}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
