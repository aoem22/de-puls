'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import MapGL, { Marker } from 'react-map-gl/maplibre';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { LayerControl } from './LayerControl';
import { MobileCategoryBar } from './MobileCategoryBar';
import { CityCrimeLayer } from './CityCrimeLayer';
import { KreisLayer } from './KreisLayer';
import type { KreisHoverInfo } from './KreisLayer';
import { KreisHoverCard } from './KreisHoverCard';
import { RankingPanel } from './RankingPanel';
import { CrimeLayer } from './CrimeLayer';
import { HexbinLayer, type BlaulichtViewMode } from './HexbinLayer';
import { GermanyBorder } from './GermanyBorder';
import { BlaulichtDetailPanel } from './BlaulichtDetailPanel';
import { KreisDetailPanel } from './KreisDetailPanel';
import { TimelineFloatingControl } from './TimelineFloatingControl';
import { BlaulichtPlaybackControl } from './BlaulichtPlaybackControl';
import { PulseMarkerOverlay } from './PulseMarkerOverlay';
import { CRIME_CATEGORIES, type CrimeRecord, type MapLocationFilter } from '@/lib/types/crime';
import { useFavorites } from '@/lib/useFavorites';
import { DEFAULT_PIPELINE_RUN } from '@/lib/dashboard/timeframes';
import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import type { CrimeCategory } from '@/lib/types/crime';
import { useCrimes, usePipelineRuns, useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta, useSearchCrimes } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

// Map styles — CARTO vector tiles (free, no API key)
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const FALLBACK_AUSLAENDER_YEARS = ['2024'];
const FALLBACK_CRIME_YEARS = ['2024'];

// Map view settings
const MIN_ZOOM = 4.5;
const MAX_ZOOM = 18;

// Germany bounds [sw_lng, sw_lat, ne_lng, ne_lat]
const GERMANY_BOUNDS: [number, number, number, number] = [5.87, 47.27, 15.04, 55.06];
const GERMANY_CENTER_LNG = 10.4515;
const GERMANY_CENTER_LAT = 51.1657;
const GERMANY_ZOOM = 6;

const KREIS_DESELECT_ZOOM_THRESHOLD = 7;
const BLAULICHT_PLAYBACK_INTERVAL_MS = 1100;
const BLAULICHT_FLASH_DURATION_MS = 1300;
const DEFAULT_BLAULICHT_COLOR = '#3b82f6';

const crimeColorMap = new Map(
  CRIME_CATEGORIES.map((category) => [category.key, category.color])
);

function getCrimeTimestamp(crime: CrimeRecord): number {
  const timestamp = Date.parse(crime.publishedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function ChoroplethMap() {
  const { theme } = useTheme();
  const mapStyle = theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
  const mapRef = useRef<MapRef | null>(null);
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isControlsExpanded, setIsControlsExpanded] = useState(false);
  const [isMobileRankingOpen, setIsMobileRankingOpen] = useState(false);
  const [shouldRenderRankingPanel, setShouldRenderRankingPanel] = useState(true);
  const [isRankingPanelVisible, setIsRankingPanelVisible] = useState(true);
  const kreisSelectTimestampRef = useRef(0);

  // Fetch dataset metadata (available years) from Supabase
  const { data: datasetMeta } = useAllDatasetMeta();

  // Derive year arrays from metadata (with fallbacks while loading)
  const auslaenderYears = datasetMeta?.auslaender?.years ?? FALLBACK_AUSLAENDER_YEARS;
  const deutschlandatlasYear = datasetMeta?.deutschlandatlas?.years?.[0] ?? '2022';
  const crimeDataYears = datasetMeta?.kriminalstatistik?.years ?? FALLBACK_CRIME_YEARS;

  // URL query param handling (?layer=safety, ?id=...)
  const searchParams = useSearchParams();

  // Unified indicator state — default varies based on URL params
  const urlLayer = searchParams.get('layer');
  const urlCrimeId = searchParams.get('id');
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorKey>(() =>
    urlCrimeId ? 'blaulicht' : (urlLayer === 'safety' ? 'deutschlandatlas' : 'blaulicht')
  );
  const [selectedSubMetric, setSelectedSubMetric] = useState<SubMetricKey>(() =>
    urlLayer === 'safety' && !urlCrimeId ? 'straft' : 'all'
  );
  const [selectedIndicatorYear, setSelectedIndicatorYear] = useState<string>('2024');
  const [isIndicatorPlaying, setIsIndicatorPlaying] = useState(false);

  const indicatorYears = useMemo((): string[] => {
    if (selectedIndicator === 'auslaender') return auslaenderYears;
    if (selectedIndicator === 'kriminalstatistik') return crimeDataYears;
    if (selectedIndicator === 'blaulicht') return [];
    return [deutschlandatlasYear];
  }, [selectedIndicator, auslaenderYears, crimeDataYears, deutschlandatlasYear]);

  const effectiveIndicatorYear = useMemo(() => {
    if (selectedIndicator === 'blaulicht') return '';
    if (indicatorYears.length === 0) return selectedIndicatorYear;
    if (indicatorYears.includes(selectedIndicatorYear)) return selectedIndicatorYear;
    return indicatorYears[indicatorYears.length - 1];
  }, [selectedIndicator, indicatorYears, selectedIndicatorYear]);

  // Fetch indicator data
  const { data: ausData } = useAuslaenderData(
    selectedIndicator === 'auslaender' ? effectiveIndicatorYear : ''
  );
  const { data: datlasData } = useDeutschlandatlasData();
  const { data: cityCrimeData } = useCityCrimeData();

  // Crime-specific state
  const [cityCrimeMetric, setCityCrimeMetric] = useState<'hz' | 'aq'>('hz');
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Kreis-specific state
  const [hoveredKreis, setHoveredKreis] = useState<string | null>(null);
  const [selectedKreis, setSelectedKreis] = useState<string | null>(null);
  const [kreisHoverInfo, setKreisHoverInfo] = useState<KreisHoverInfo | null>(null);

  // Derive kreisName from data when a Kreis is selected
  const selectedKreisName = useMemo(() => {
    if (!selectedKreis) return '';
    return ausData?.[selectedKreis]?.name || datlasData?.[selectedKreis]?.name || selectedKreis;
  }, [selectedKreis, ausData, datlasData]);

  // Zoom level tracking
  const [currentZoom, setCurrentZoom] = useState<number>(GERMANY_ZOOM);

  // Blaulicht crime state
  const [selectedCrime, setSelectedCrime] = useState<CrimeRecord | null>(null);
  const [hoveredCrime, setHoveredCrime] = useState<CrimeRecord | null>(null);
  const [selectedBlaulichtCategory, setSelectedBlaulichtCategory] = useState<CrimeCategory | null>(null);
  const [selectedWeaponType, setSelectedWeaponType] = useState<string | null>(null);
  const [selectedDrugType, setSelectedDrugType] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<MapLocationFilter | null>(null);
  const [selectedPipelineRun, setSelectedPipelineRun] = useState<string | undefined>(DEFAULT_PIPELINE_RUN);
  const [isBlaulichtPlaying, setIsBlaulichtPlaying] = useState(false);
  const [blaulichtPlaybackIndex, setBlaulichtPlaybackIndex] = useState<number | null>(null);
  const [flashingCrimeIds, setFlashingCrimeIds] = useState<Set<string>>(new Set());
  const [detailPanelFlashToken, setDetailPanelFlashToken] = useState(0);
  const flashTimeoutsRef = useRef<Map<string, number>>(new Map());
  const { favoriteIds, toggleFavorite, isFavorite, count: favoritesCount, getComment, setComment } = useFavorites();
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [blaulichtViewMode, setBlaulichtViewMode] = useState<BlaulichtViewMode>('dots');
  const [filterEnrichedOnly, setFilterEnrichedOnly] = useState(false);
  const [filterGeotaggedOnly, setFilterGeotaggedOnly] = useState(false);
  const [dateFilterFrom, setDateFilterFrom] = useState<string | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [dateFilterTo, setDateFilterTo] = useState<string | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [searchPin, setSearchPin] = useState<{ lng: number; lat: number } | null>(null);

  // Full-text search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search query (300ms)
  useEffect(() => {
    if (!searchQuery) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResultIds, isValidating: isSearching } = useSearchCrimes(debouncedSearch);

  const searchIdSet = useMemo(
    () => (searchResultIds ? new Set(searchResultIds) : null),
    [searchResultIds],
  );

  // ID of the first symbol (label) layer in the basemap style.
  // Data layers use this as beforeId so they render below city/place labels.
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>(undefined);

  // iOS Safari toolbar-collapse hack:
  // make the document scrollable by 1px and nudge scroll so browser chrome minimizes.
  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIOS =
      /iP(hone|od|ad)/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const isWebKit = /WebKit/i.test(ua);
    const isAltBrowser = /CriOS|FxiOS|OPiOS|EdgiOS|DuckDuckGo/i.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Legacy iOS Safari standalone flag
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (!isIOS || !isWebKit || isAltBrowser || isStandalone) return;

    const html = document.documentElement;
    const body = document.body;
    html.classList.add('ios-safari-chrome-hack');
    body.classList.add('ios-safari-chrome-hack');

    let raf1: number | null = null;
    let raf2: number | null = null;
    let timeoutId: number | null = null;

    const nudge = () => {
      if (window.scrollY <= 0) {
        window.scrollTo(0, 1);
      }
    };

    const scheduleNudge = () => {
      if (raf1 !== null) window.cancelAnimationFrame(raf1);
      if (raf2 !== null) window.cancelAnimationFrame(raf2);
      if (timeoutId !== null) window.clearTimeout(timeoutId);

      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(nudge);
      });
      timeoutId = window.setTimeout(nudge, 320);
    };

    const handleVisibility = () => {
      if (!document.hidden) scheduleNudge();
    };

    scheduleNudge();
    window.addEventListener('pageshow', scheduleNudge);
    window.addEventListener('orientationchange', scheduleNudge);
    window.addEventListener('resize', scheduleNudge);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (raf1 !== null) window.cancelAnimationFrame(raf1);
      if (raf2 !== null) window.cancelAnimationFrame(raf2);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener('pageshow', scheduleNudge);
      window.removeEventListener('orientationchange', scheduleNudge);
      window.removeEventListener('resize', scheduleNudge);
      document.removeEventListener('visibilitychange', handleVisibility);
      html.classList.remove('ios-safari-chrome-hack');
      body.classList.remove('ios-safari-chrome-hack');
    };
  }, []);

  // Layer visibility
  const showCityCrimeLayer = selectedIndicator === 'kriminalstatistik';
  const showBlaulichtLayer = selectedIndicator === 'blaulicht';
  const showKreisLayer = !showCityCrimeLayer && !showBlaulichtLayer;
  const shouldShowRankingPanel = !showBlaulichtLayer;

  // Fetch Blaulicht data (filtered by pipeline run if selected)
  const { data: blaulichtCrimes = [] } = useCrimes(undefined, selectedPipelineRun);
  const { data: pipelineRuns } = usePipelineRuns();

  // Counts for data quality filter pills (before filtering)
  const qualityCounts = useMemo(() => ({
    enriched: blaulichtCrimes.filter((c) => c.categories.length > 0).length,
    geotagged: blaulichtCrimes.filter((c) => c.latitude != null && c.longitude != null).length,
    total: blaulichtCrimes.length,
  }), [blaulichtCrimes]);

  // Apply enriched/geotagged quality filters
  const filteredBlaulichtCrimes = useMemo(() => {
    let crimes = blaulichtCrimes;
    if (filterEnrichedOnly) {
      crimes = crimes.filter((c) => c.categories.length > 0);
    }
    if (filterGeotaggedOnly) {
      crimes = crimes.filter((c) => c.latitude != null && c.longitude != null);
    }
    return crimes;
  }, [blaulichtCrimes, filterEnrichedOnly, filterGeotaggedOnly]);

  // Compute stats from the filtered crimes (already filtered by pipeline run + quality)
  const stats = useMemo(() => {
    const byCategory: Partial<Record<CrimeCategory, number>> = {};
    let geocoded = 0;
    for (const crime of filteredBlaulichtCrimes) {
      if (crime.latitude != null) geocoded++;
      for (const cat of crime.categories) {
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      }
    }
    return { total: filteredBlaulichtCrimes.length, geocoded, byCategory };
  }, [filteredBlaulichtCrimes]);

  const weaponCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const crime of filteredBlaulichtCrimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      if (selectedBlaulichtCategory && !crime.categories.includes(selectedBlaulichtCategory)) continue;
      const wt = crime.weaponType;
      if (wt && wt !== 'none' && wt !== 'unknown') {
        counts[wt] = (counts[wt] || 0) + 1;
      }
    }
    return counts;
  }, [filteredBlaulichtCrimes, selectedBlaulichtCategory]);

  const drugCounts = useMemo(() => {
    if (selectedBlaulichtCategory !== 'drugs') return {};
    const counts: Record<string, number> = {};
    for (const crime of filteredBlaulichtCrimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      if (!crime.categories.includes('drugs')) continue;
      const dt = crime.drugType;
      if (dt) {
        counts[dt] = (counts[dt] || 0) + 1;
      }
    }
    return counts;
  }, [filteredBlaulichtCrimes, selectedBlaulichtCategory]);

  const locationOptions = useMemo(() => {
    const blCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const plzCounts: Record<string, number> = {};
    for (const crime of filteredBlaulichtCrimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      if (selectedBlaulichtCategory && !crime.categories.includes(selectedBlaulichtCategory)) continue;
      if (crime.bundesland) blCounts[crime.bundesland] = (blCounts[crime.bundesland] || 0) + 1;
      if (crime.city) cityCounts[crime.city] = (cityCounts[crime.city] || 0) + 1;
      if (crime.plz) plzCounts[crime.plz] = (plzCounts[crime.plz] || 0) + 1;
    }
    const opts: Array<{ type: 'bundesland' | 'city' | 'plz'; value: string; count: number }> = [];
    for (const [v, c] of Object.entries(blCounts)) opts.push({ type: 'bundesland', value: v, count: c });
    for (const [v, c] of Object.entries(cityCounts)) opts.push({ type: 'city', value: v, count: c });
    for (const [v, c] of Object.entries(plzCounts)) opts.push({ type: 'plz', value: v, count: c });
    opts.sort((a, b) => b.count - a.count);
    return opts;
  }, [filteredBlaulichtCrimes, selectedBlaulichtCategory]);

  const orderedBlaulichtCrimes = useMemo(() => {
    const filtered = filteredBlaulichtCrimes
      .filter((crime) => crime.latitude != null && crime.longitude != null)
      .filter((crime) => !selectedBlaulichtCategory || crime.categories.includes(selectedBlaulichtCategory))
      .filter((crime) => !selectedWeaponType || crime.weaponType === selectedWeaponType)
      .filter((crime) => !selectedDrugType || crime.drugType === selectedDrugType)
      .filter((crime) => {
        if (!locationFilter) return true;
        if (locationFilter.type === 'bundesland') return crime.bundesland === locationFilter.value;
        if (locationFilter.type === 'city') return crime.city === locationFilter.value;
        if (locationFilter.type === 'plz') return crime.plz === locationFilter.value;
        return true;
      })
      .filter((crime) => !searchIdSet || searchIdSet.has(crime.id))
      .filter((crime) => !showFavoritesOnly || favoriteIds.has(crime.id))
      .filter((crime) => {
        if (!dateFilterFrom && !dateFilterTo) return true;
        const ts = getCrimeTimestamp(crime);
        if (ts === 0) return false;
        if (dateFilterFrom && ts < new Date(dateFilterFrom + 'T00:00:00').getTime()) return false;
        if (dateFilterTo && ts > new Date(dateFilterTo + 'T23:59:59.999').getTime()) return false;
        return true;
      });
    filtered.sort((left, right) => getCrimeTimestamp(left) - getCrimeTimestamp(right));
    return filtered;
  }, [filteredBlaulichtCrimes, selectedBlaulichtCategory, selectedWeaponType, selectedDrugType, locationFilter, searchIdSet, showFavoritesOnly, favoriteIds, dateFilterFrom, dateFilterTo]);

  const clampedBlaulichtIndex = useMemo(() => {
    if (orderedBlaulichtCrimes.length === 0) return -1;
    if (blaulichtPlaybackIndex === null) return orderedBlaulichtCrimes.length - 1;
    if (blaulichtPlaybackIndex < 0) return -1;
    if (blaulichtPlaybackIndex >= orderedBlaulichtCrimes.length) return orderedBlaulichtCrimes.length - 1;
    return blaulichtPlaybackIndex;
  }, [orderedBlaulichtCrimes.length, blaulichtPlaybackIndex]);

  const visibleBlaulichtCrimeIds = useMemo(() => {
    if (!showBlaulichtLayer) return null;
    if (orderedBlaulichtCrimes.length === 0 || clampedBlaulichtIndex < 0) return new Set<string>();
    return new Set(orderedBlaulichtCrimes.slice(0, clampedBlaulichtIndex + 1).map((c) => c.id));
  }, [showBlaulichtLayer, orderedBlaulichtCrimes, clampedBlaulichtIndex]);

  const crimeById = useMemo(() => {
    const m = new Map<string, CrimeRecord>();
    for (const crime of orderedBlaulichtCrimes) m.set(crime.id, crime);
    return m;
  }, [orderedBlaulichtCrimes]);

  // Auto-select crime from URL ?id= param (e.g. from live feed click)
  const urlCrimeHandled = useRef(false);
  useEffect(() => {
    if (urlCrimeHandled.current || !urlCrimeId || blaulichtCrimes.length === 0) return;
    const match = blaulichtCrimes.find((c) => c.id === urlCrimeId);
    if (!match) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      setSelectedCrime(match);
      urlCrimeHandled.current = true;
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [urlCrimeId, blaulichtCrimes]);

  const flashingCrimes = useMemo(() => {
    const items: CrimeRecord[] = [];
    for (const crimeId of flashingCrimeIds) {
      const crime = crimeById.get(crimeId);
      if (crime) items.push(crime);
    }
    return items;
  }, [crimeById, flashingCrimeIds]);

  const playbackCurrentCrime = useMemo(() => {
    if (clampedBlaulichtIndex < 0) return null;
    return orderedBlaulichtCrimes[clampedBlaulichtIndex] ?? null;
  }, [orderedBlaulichtCrimes, clampedBlaulichtIndex]);

  const selectedCrimeInTimeline = useMemo(() => {
    if (!selectedCrime) return null;
    return crimeById.has(selectedCrime.id) ? selectedCrime : null;
  }, [selectedCrime, crimeById]);

  const hoveredCrimeInTimeline = useMemo(() => {
    if (!hoveredCrime) return null;
    return crimeById.has(hoveredCrime.id) ? hoveredCrime : null;
  }, [hoveredCrime, crimeById]);

  // ── Map view reset helpers ──────────────────────────────────────

  const previousSelectedKreisRef = useRef<string | null>(null);
  const previousMobileRankingRef = useRef(false);

  // Reset view when leaving selected Kreis detail mode
  useEffect(() => {
    const hadSelection = Boolean(previousSelectedKreisRef.current);
    const leftSelectionMode = hadSelection && !selectedKreis;

    if (showKreisLayer && leftSelectionMode && mapRef.current) {
      const container = mapRef.current.getContainer();
      const isMobile = container.clientWidth < 768;
      mapRef.current.fitBounds(GERMANY_BOUNDS, {
        padding: {
          top: 80 + (isMobile ? 60 : 0),
          bottom: 80 + (isMobile ? 140 : 0),
          left: 80,
          right: 80,
        },
        maxZoom: GERMANY_ZOOM,
      });
    }

    previousSelectedKreisRef.current = selectedKreis;
  }, [showKreisLayer, selectedKreis]);

  // Reset view when closing mobile ranking panel (only when nothing is selected)
  useEffect(() => {
    const wasOpen = previousMobileRankingRef.current;
    const justClosed = wasOpen && !isMobileRankingOpen;
    const hasActiveSelection = Boolean(selectedKreis || selectedCity);

    if (justClosed && !hasActiveSelection && mapRef.current) {
      const container = mapRef.current.getContainer();
      const isMobile = container.clientWidth < 768;
      if (isMobile) {
        mapRef.current.fitBounds(GERMANY_BOUNDS, {
          padding: { top: 140, bottom: 220, left: 80, right: 80 },
          maxZoom: GERMANY_ZOOM,
        });
      }
    }

    previousMobileRankingRef.current = isMobileRankingOpen;
  }, [isMobileRankingOpen, selectedKreis, selectedCity]);

  // ── Playback timers (identical logic) ───────────────────────────

  // Indicator year playback
  useEffect(() => {
    if (!isIndicatorPlaying || indicatorYears.length <= 1) return;
    const interval = window.setInterval(() => {
      setSelectedIndicatorYear((current) => {
        const idx = indicatorYears.indexOf(current);
        return indicatorYears[(idx + 1) % indicatorYears.length];
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [isIndicatorPlaying, indicatorYears]);

  // Clear flash timeouts on unmount
  useEffect(() => {
    const reg = flashTimeoutsRef.current;
    return () => {
      for (const id of reg.values()) window.clearTimeout(id);
      reg.clear();
    };
  }, []);

  // Blaulicht timeline playback
  useEffect(() => {
    if (!showBlaulichtLayer || !isBlaulichtPlaying || orderedBlaulichtCrimes.length === 0) return;

    const interval = window.setInterval(() => {
      setBlaulichtPlaybackIndex((current) => {
        const currentIndex = current ?? orderedBlaulichtCrimes.length - 1;
        const nextIndex = currentIndex + 1;

        if (nextIndex >= orderedBlaulichtCrimes.length) {
          setIsBlaulichtPlaying(false);
          return orderedBlaulichtCrimes.length - 1;
        }

        const nextCrime = orderedBlaulichtCrimes[nextIndex];
        setSelectedCrime(nextCrime);
        setHoveredCrime(null);
        setDetailPanelFlashToken((t) => t + 1);

        setFlashingCrimeIds((prev) => {
          const next = new Set(prev);
          next.add(nextCrime.id);
          return next;
        });

        const existing = flashTimeoutsRef.current.get(nextCrime.id);
        if (existing) window.clearTimeout(existing);

        const tid = window.setTimeout(() => {
          setFlashingCrimeIds((prev) => {
            if (!prev.has(nextCrime.id)) return prev;
            const next = new Set(prev);
            next.delete(nextCrime.id);
            return next;
          });
          flashTimeoutsRef.current.delete(nextCrime.id);
        }, BLAULICHT_FLASH_DURATION_MS);

        flashTimeoutsRef.current.set(nextCrime.id, tid);
        return nextIndex;
      });
    }, BLAULICHT_PLAYBACK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [showBlaulichtLayer, isBlaulichtPlaying, orderedBlaulichtCrimes]);

  // ── Event handlers ──────────────────────────────────────────────

  const handleZoom = useCallback((e: ViewStateChangeEvent) => {
    const zoom = e.viewState.zoom;
    const quantizedZoom = Math.round(zoom * 10) / 10;
    setCurrentZoom((previous) => (previous === quantizedZoom ? previous : quantizedZoom));
    // Skip deselection during programmatic fitBounds (e.g. after clicking a Kreis on the map)
    if (zoom <= KREIS_DESELECT_ZOOM_THRESHOLD && Date.now() - kreisSelectTimestampRef.current > 800) {
      setSelectedKreis((prev) => (prev ? null : prev));
    }
  }, []);

  const handleToggleBlaulichtPlayback = useCallback(() => {
    if (orderedBlaulichtCrimes.length === 0) return;
    setIsBlaulichtPlaying((previous) => {
      if (previous) return false;
      if (clampedBlaulichtIndex >= orderedBlaulichtCrimes.length - 1) {
        setBlaulichtPlaybackIndex(-1);
        setSelectedCrime(null);
        setHoveredCrime(null);
      }
      return true;
    });
  }, [orderedBlaulichtCrimes.length, clampedBlaulichtIndex]);

  const handleBlaulichtCategoryChange = useCallback((category: CrimeCategory | null) => {
    setSelectedBlaulichtCategory(category);
    setSelectedWeaponType(null);
    setSelectedDrugType(null);
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleDateFilterChange = useCallback((from: string | null, to: string | null) => {
    setDateFilterFrom(from);
    setDateFilterTo(to);
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleWeaponTypeChange = useCallback((weaponType: string | null) => {
    setSelectedWeaponType(weaponType);
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleLocationFilterChange = useCallback((filter: MapLocationFilter | null) => {
    setLocationFilter(filter);
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleDrugTypeChange = useCallback((drugType: string | null) => {
    setSelectedDrugType(drugType);
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleBlaulichtScrub = useCallback((nextIndex: number) => {
    if (orderedBlaulichtCrimes.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(nextIndex, orderedBlaulichtCrimes.length - 1));
    setBlaulichtPlaybackIndex(clampedIndex);
    setIsBlaulichtPlaying(false);
    setHoveredCrime(null);
    setSelectedCrime(orderedBlaulichtCrimes[clampedIndex] ?? null);
  }, [orderedBlaulichtCrimes]);

  // Keep ranking panel mounted for animation
  useEffect(() => {
    let rafId: number | null = null;
    let nestedRafId: number | null = null;
    let timeoutId: number | null = null;

    if (shouldShowRankingPanel) {
      rafId = window.requestAnimationFrame(() => {
        setShouldRenderRankingPanel(true);
        nestedRafId = window.requestAnimationFrame(() => setIsRankingPanelVisible(true));
      });
    } else {
      rafId = window.requestAnimationFrame(() => {
        setIsRankingPanelVisible(false);
        timeoutId = window.setTimeout(() => setShouldRenderRankingPanel(false), 260);
      });
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (nestedRafId !== null) window.cancelAnimationFrame(nestedRafId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [shouldShowRankingPanel]);

  // ── Map language + load handler ─────────────────────────────────

  const setMapLanguage = useCallback((map: MapRef) => {
    const style = map.getStyle();
    if (!style?.layers) return;
    const gl = map.getMap();
    for (const layer of style.layers) {
      if (layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']) {
        gl.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:de'], ['get', 'name']]);
        gl.setPaintProperty(layer.id, 'text-color', '#000000');
        gl.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
        gl.setPaintProperty(layer.id, 'text-halo-width', 1.5);
      }
    }
  }, []);

  // Find the first symbol (label) layer in the basemap style so
  // data layers can be inserted below it via beforeId.
  const updateLabelLayerId = useCallback((map: MapRef) => {
    const layers = map.getStyle()?.layers;
    if (!layers) return;
    for (const layer of layers) {
      if (layer.type === 'symbol') {
        setLabelLayerId(layer.id);
        return;
      }
    }
  }, []);

  const handleLoad = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Switch all labels to German and find first label layer
    setMapLanguage(map);
    updateLabelLayerId(map);

    // Re-apply on style reload (e.g. theme change)
    map.getMap().on('styledata', () => {
      setMapLanguage(map);
      updateLabelLayerId(map);
    });

    // Allow pinch-to-zoom but disable the rotation part
    map.getMap().touchZoomRotate.disableRotation();

    const container = map.getContainer();
    const isMobile = container.clientWidth < 768;

    const padding = isMobile
      ? { top: 80, bottom: 160, left: 20, right: 20 }
      : {
          top: 0.1 * container.clientHeight,
          bottom: 0.1 * container.clientHeight,
          left: 0.1 * container.clientWidth,
          right: 0.1 * container.clientWidth,
        };

    map.fitBounds(GERMANY_BOUNDS, { padding });

    // After fitBounds animation completes, lock minZoom to the fitted level
    // so the user can never zoom out further than the initial Germany view
    map.getMap().once('moveend', () => {
      const fittedZoom = map.getMap().getZoom();
      if (fittedZoom >= MIN_ZOOM) {
        map.getMap().setMinZoom(fittedZoom);
      }
    });
  }, [setMapLanguage, updateLabelLayerId]);

  // Resize map when container changes
  useEffect(() => {
    const wrapper = mapWrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // Shared props forwarded to LayerControl (desktop floating + mobile overlay)
  const layerControlProps = {
    selectedIndicator,
    onIndicatorChange: (indicator: IndicatorKey) => {
      setSelectedIndicator(indicator);
      setIsIndicatorPlaying(false);
      setIsBlaulichtPlaying(false);
      if (indicator === 'auslaender') {
        setSelectedSubMetric('total');
        setSelectedIndicatorYear(auslaenderYears[auslaenderYears.length - 1] ?? '2024');
      } else if (indicator === 'deutschlandatlas') {
        setSelectedSubMetric('kinder_bg');
        setSelectedIndicatorYear(deutschlandatlasYear);
      } else if (indicator === 'kriminalstatistik') {
        setSelectedSubMetric('total');
        setSelectedIndicatorYear(crimeDataYears[crimeDataYears.length - 1] ?? '2024');
      } else if (indicator === 'blaulicht') {
        setSelectedSubMetric('all');
        setSelectedIndicatorYear('');
      }
      setSelectedKreis(null);
      setSelectedCity(null);
      setSelectedCrime(null);
      setHoveredCrime(null);
      setSelectedBlaulichtCategory(null);
      setSelectedWeaponType(null);
      setSelectedDrugType(null);
      setLocationFilter(null);
      setSearchQuery('');
      setBlaulichtPlaybackIndex(null);
      setFlashingCrimeIds(new Set());
      setDateFilterFrom(null);
      setDateFilterTo(null);
      setIsControlsExpanded(false);
      setIsMobileRankingOpen(false);
    },
    selectedSubMetric,
    onSubMetricChange: setSelectedSubMetric,
    selectedIndicatorYear: effectiveIndicatorYear,
    cityCrimeMetric,
    onCityCrimeMetricChange: setCityCrimeMetric,
    blaulichtStats: stats,
    selectedBlaulichtCategory,
    onBlaulichtCategoryChange: handleBlaulichtCategoryChange,
    weaponCounts,
    selectedWeaponType,
    onWeaponTypeChange: handleWeaponTypeChange,
    drugCounts,
    selectedDrugType,
    onDrugTypeChange: handleDrugTypeChange,
    locationOptions,
    locationFilter,
    onLocationFilterChange: handleLocationFilterChange,
    searchQuery,
    onSearchQueryChange: setSearchQuery,
    searchResultCount: searchResultIds?.length ?? null,
    isSearching: isSearching && debouncedSearch.length >= 2,
    favoritesCount,
    showFavoritesOnly,
    onToggleFavoritesOnly: () => setShowFavoritesOnly((prev) => !prev),
    blaulichtViewMode,
    onBlaulichtViewModeChange: setBlaulichtViewMode,
    pipelineRuns,
    selectedPipelineRun,
    onPipelineRunChange: setSelectedPipelineRun,
    filterEnrichedOnly,
    onFilterEnrichedChange: () => setFilterEnrichedOnly((prev) => !prev),
    filterGeotaggedOnly,
    onFilterGeotaggedChange: () => setFilterGeotaggedOnly((prev) => !prev),
    enrichedCount: qualityCounts.enriched,
    geotaggedCount: qualityCounts.geotagged,
    totalCrimeCount: qualityCounts.total,
    indicatorYears,
    onYearChange: (year: string) => { setSelectedIndicatorYear(year); setIsIndicatorPlaying(false); },
    isPlaying: isIndicatorPlaying,
    onTogglePlay: () => setIsIndicatorPlaying((prev) => !prev),
    auslaenderData: ausData,
    deutschlandatlasData: datlasData,
    cityCrimeData,
  };

  return (
    <div className="relative w-full h-full">
      {/* Map area — fills full space */}
      <div ref={mapWrapperRef} className="relative w-full h-full">
      <MapGL
        ref={mapRef}
        mapStyle={mapStyle}
        initialViewState={{
          longitude: GERMANY_CENTER_LNG,
          latitude: GERMANY_CENTER_LAT,
          zoom: GERMANY_ZOOM,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={[
          [GERMANY_BOUNDS[0] - 10, GERMANY_BOUNDS[1] - 8],
          [GERMANY_BOUNDS[2] + 10, GERMANY_BOUNDS[3] + 8],
        ]}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        maxPitch={0}
        onZoom={handleZoom}
        onLoad={handleLoad}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Germany border with glow */}
        <GermanyBorder />

        {/* City crime layer (when kriminalstatistik is selected) */}
        {showCityCrimeLayer && (
          <CityCrimeLayer
            selectedCrimeType={selectedSubMetric as CrimeTypeKey}
            metric={cityCrimeMetric}
            selectedYear={effectiveIndicatorYear}
            hoveredCity={hoveredCity}
            onHoverCity={setHoveredCity}
            onClickCity={setSelectedCity}
            currentZoom={currentZoom}
            selectedCity={selectedCity}
            cityCrimeData={cityCrimeData}
          />
        )}

        {/* Kreis indicator layer */}
        {showKreisLayer && (
          <KreisLayer
            indicatorKey={selectedIndicator}
            subMetric={selectedSubMetric}
            selectedYear={effectiveIndicatorYear}
            hoveredKreis={hoveredKreis}
            onHoverKreis={setHoveredKreis}
            onHoverInfo={setKreisHoverInfo}
            onClickKreis={(ags) => { setSelectedKreis(ags); if (ags) kreisSelectTimestampRef.current = Date.now(); }}
            selectedKreis={selectedKreis}
            currentZoom={currentZoom}
            auslaenderData={ausData}
            deutschlandatlasData={datlasData}
          />
        )}

        {/* Blaulicht hexbin density underlay */}
        {showBlaulichtLayer && (blaulichtViewMode === 'density' || blaulichtViewMode === 'both') && (
          <HexbinLayer
            crimes={orderedBlaulichtCrimes}
            currentZoom={currentZoom}
            visible
            beforeCrimeCircles={blaulichtViewMode === 'both'}
            beforeLabelId={labelLayerId}
          />
        )}

        {/* Blaulicht crime markers */}
        {showBlaulichtLayer && (blaulichtViewMode === 'dots' || blaulichtViewMode === 'both') && (
          <CrimeLayer
            crimes={orderedBlaulichtCrimes}
            monochrome
            onCrimeClick={(crime) => {
              setIsBlaulichtPlaying(false);
              setSelectedCrime(crime);
              setHoveredCrime(null);
            }}
            onCrimeHover={(crime) => {
              if (isBlaulichtPlaying) return;
              setHoveredCrime(crime);
            }}
            selectedCrimeId={selectedCrimeInTimeline?.id}
            hoveredCrimeId={hoveredCrimeInTimeline?.id}
            filterCategory={selectedBlaulichtCategory}
            visibleCrimeIds={visibleBlaulichtCrimeIds}
            flashingCrimeIds={flashingCrimeIds}
            favoriteIds={favoriteIds}
            beforeId={labelLayerId}
          />
        )}

        {/* Pulse overlay for newly appeared crimes */}
        {showBlaulichtLayer && flashingCrimes.map((crime) => {
          if (crime.latitude == null || crime.longitude == null) return null;
          const category = crime.categories[0];
          const color = (category ? crimeColorMap.get(category) : null) ?? DEFAULT_BLAULICHT_COLOR;
          return (
            <PulseMarkerOverlay
              key={crime.id}
              lat={crime.latitude}
              lng={crime.longitude}
              color={color}
            />
          );
        })}

        {/* Address search — standalone only when NOT in blaulicht mode (bottom bar has its own) */}

        {/* Search pin marker (from bottom-bar search in blaulicht mode) */}
        {searchPin && (
          <Marker longitude={searchPin.lng} latitude={searchPin.lat} anchor="bottom">
            <svg width="24" height="36" viewBox="0 0 24 36" fill="none">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z" fill="#22d3ee" />
              <circle cx="12" cy="12" r="5" fill={theme === 'dark' ? '#0a0a0a' : '#ffffff'} />
            </svg>
          </Marker>
        )}
      </MapGL>

      {/* Mobile category bar */}
      <MobileCategoryBar
        selectedIndicator={selectedIndicator}
        onIndicatorChange={layerControlProps.onIndicatorChange}
        onOpenSettings={() => setIsControlsExpanded((prev) => !prev)}
        isSettingsOpen={isControlsExpanded}
      />

      {/* Mobile controls backdrop */}
      {isControlsExpanded && (
        <div
          className="md:hidden fixed inset-0 z-[999] bg-black/30 backdrop-enter"
          onClick={() => setIsControlsExpanded(false)}
        />
      )}

      {/* Desktop floating LayerControl (top-left overlay) */}
      <div className="hidden md:block absolute z-[1000] top-3 left-3 w-[280px]">
        <LayerControl {...layerControlProps} />
      </div>

      {/* Controls overlay (mobile only) */}
      <div
        className={`
          md:hidden absolute z-[1000] top-[4.5rem] right-3 left-3
          transition-[opacity,transform] duration-200 ease-out
          max-h-[calc(100vh-5rem)] overflow-y-auto
          ${isControlsExpanded
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2 pointer-events-none'
          }
        `}
      >
        <LayerControl {...layerControlProps} hideIndicatorSelector />
      </div>

      {/* Timeline transport controls */}
      {!showBlaulichtLayer && (
        <TimelineFloatingControl
          years={indicatorYears}
          selectedYear={effectiveIndicatorYear}
          isPlaying={isIndicatorPlaying}
          onTogglePlay={() => setIsIndicatorPlaying((prev) => !prev)}
          onYearChange={(year) => {
            setSelectedIndicatorYear(year);
            setIsIndicatorPlaying(false);
          }}
          accent={selectedIndicator === 'auslaender' ? 'red' : 'amber'}
          className="hidden md:block bottom-20 md:bottom-4"
        />
      )}

      {showBlaulichtLayer && !isControlsExpanded && (
        <BlaulichtPlaybackControl
          totalEvents={orderedBlaulichtCrimes.length}
          currentIndex={clampedBlaulichtIndex}
          isPlaying={isBlaulichtPlaying}
          onTogglePlay={handleToggleBlaulichtPlayback}
          onIndexChange={handleBlaulichtScrub}
          currentTimestamp={playbackCurrentCrime?.publishedAt}
          dateFilterFrom={dateFilterFrom}
          dateFilterTo={dateFilterTo}
          onDateFilterChange={handleDateFilterChange}
          mapRef={mapRef}
          onSearchPinChange={setSearchPin}
          blaulichtStats={stats}
          selectedCategory={selectedBlaulichtCategory}
          onCategoryChange={handleBlaulichtCategoryChange}
          weaponCounts={weaponCounts}
          selectedWeaponType={selectedWeaponType}
          onWeaponTypeChange={handleWeaponTypeChange}
          className="bottom-4 md:bottom-4"
        />
      )}

      {/* Kreis hover card (desktop) */}
      <div className="hidden md:block">
        {kreisHoverInfo && !selectedKreis && showKreisLayer && (
          <KreisHoverCard
            mouseX={kreisHoverInfo.mouseX}
            mouseY={kreisHoverInfo.mouseY}
            kreisName={kreisHoverInfo.name}
            ags={kreisHoverInfo.ags}
            indicatorKey={selectedIndicator}
            selectedSubMetric={selectedSubMetric}
            auslaenderData={ausData}
            deutschlandatlasData={datlasData}
          />
        )}
      </div>

      {/* Ranking panel */}
      {shouldRenderRankingPanel && (
        <RankingPanel
          indicatorKey={selectedIndicator}
          subMetric={selectedSubMetric}
          selectedYear={effectiveIndicatorYear}
          hoveredAgs={showCityCrimeLayer ? hoveredCity : hoveredKreis}
          selectedAgs={showCityCrimeLayer ? selectedCity : selectedKreis}
          onHoverAgs={showCityCrimeLayer ? setHoveredCity : setHoveredKreis}
          onSelectAgs={showCityCrimeLayer ? setSelectedCity : setSelectedKreis}
          isMobileOpen={isMobileRankingOpen}
          onMobileToggle={() => setIsMobileRankingOpen((prev) => !prev)}
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
          cityCrimeData={cityCrimeData}
          cityCrimeMetric={cityCrimeMetric}
          deutschlandatlasYear={deutschlandatlasYear}
          isVisible={isRankingPanelVisible}
        />
      )}

      {/* Blaulicht detail panel */}
      {showBlaulichtLayer && (selectedCrimeInTimeline || hoveredCrimeInTimeline) && (
        <BlaulichtDetailPanel
          crime={selectedCrimeInTimeline || hoveredCrimeInTimeline!}
          onClose={() => {
            setSelectedCrime(null);
            setHoveredCrime(null);
            setIsBlaulichtPlaying(false);
          }}
          isPreview={!selectedCrimeInTimeline && !!hoveredCrimeInTimeline}
          flashToken={detailPanelFlashToken}
          isFavorite={isFavorite((selectedCrimeInTimeline || hoveredCrimeInTimeline!).id)}
          onToggleFavorite={toggleFavorite}
          favoriteComment={getComment((selectedCrimeInTimeline || hoveredCrimeInTimeline!).id)}
          onSetFavoriteComment={setComment}
        />
      )}

      {/* Kreis detail panel — only when ranking panel is NOT rendered (it has its own rich detail view) */}
      {showKreisLayer && selectedKreis && !shouldRenderRankingPanel && (
        <KreisDetailPanel
          ags={selectedKreis}
          kreisName={selectedKreisName}
          indicatorKey={selectedIndicator}
          selectedSubMetric={selectedSubMetric}
          selectedYear={effectiveIndicatorYear}
          onClose={() => setSelectedKreis(null)}
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
        />
      )}
      </div>{/* end map wrapper */}
    </div>
  );
}
