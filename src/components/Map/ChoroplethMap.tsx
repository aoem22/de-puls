'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import MapGL from 'react-map-gl/maplibre';
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
import { TimelineFloatingControl } from './TimelineFloatingControl';
import { BlaulichtPlaybackControl } from './BlaulichtPlaybackControl';
import { PulseMarkerOverlay } from './PulseMarkerOverlay';
import { AddressSearch } from './AddressSearch';
import { CRIME_CATEGORIES, type CrimeRecord } from '@/lib/types/crime';
import { useFavorites } from '@/lib/useFavorites';
import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import type { CrimeCategory } from '@/lib/types/crime';
import { useCrimes, usePipelineRuns, useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta } from '@/lib/supabase';

// Map style — CARTO Dark Matter vector tiles (free, no API key)
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const FALLBACK_AUSLAENDER_YEARS = ['2024'];
const FALLBACK_CRIME_YEARS = ['2024'];

// Map view settings
const MIN_ZOOM = 3.5;
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
  const mapRef = useRef<MapRef | null>(null);
  const [isControlsExpanded, setIsControlsExpanded] = useState(false);
  const [isMobileRankingOpen, setIsMobileRankingOpen] = useState(false);
  const [shouldRenderRankingPanel, setShouldRenderRankingPanel] = useState(true);
  const [isRankingPanelVisible, setIsRankingPanelVisible] = useState(true);

  // Fetch dataset metadata (available years) from Supabase
  const { data: datasetMeta } = useAllDatasetMeta();

  // Derive year arrays from metadata (with fallbacks while loading)
  const auslaenderYears = datasetMeta?.auslaender?.years ?? FALLBACK_AUSLAENDER_YEARS;
  const deutschlandatlasYear = datasetMeta?.deutschlandatlas?.years?.[0] ?? '2022';
  const crimeDataYears = datasetMeta?.kriminalstatistik?.years ?? FALLBACK_CRIME_YEARS;

  // Unified indicator state
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorKey>('auslaender');
  const [selectedSubMetric, setSelectedSubMetric] = useState<SubMetricKey>('total');
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

  // Zoom level tracking
  const [currentZoom, setCurrentZoom] = useState<number>(GERMANY_ZOOM);

  // Blaulicht crime state
  const [selectedCrime, setSelectedCrime] = useState<CrimeRecord | null>(null);
  const [hoveredCrime, setHoveredCrime] = useState<CrimeRecord | null>(null);
  const [selectedBlaulichtCategory, setSelectedBlaulichtCategory] = useState<CrimeCategory | null>(null);
  const [selectedWeaponType, setSelectedWeaponType] = useState<string | null>(null);
  const [selectedPipelineRun, setSelectedPipelineRun] = useState<string | undefined>(undefined);
  const [isBlaulichtPlaying, setIsBlaulichtPlaying] = useState(false);
  const [blaulichtPlaybackIndex, setBlaulichtPlaybackIndex] = useState<number | null>(null);
  const [flashingCrimeIds, setFlashingCrimeIds] = useState<Set<string>>(new Set());
  const [detailPanelFlashToken, setDetailPanelFlashToken] = useState(0);
  const flashTimeoutsRef = useRef<Map<string, number>>(new Map());
  const { favoriteIds, toggleFavorite, isFavorite, count: favoritesCount, getComment, setComment } = useFavorites();
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [blaulichtViewMode, setBlaulichtViewMode] = useState<BlaulichtViewMode>('both');
  const [dateFilterFrom, setDateFilterFrom] = useState<string | null>(null);
  const [dateFilterTo, setDateFilterTo] = useState<string | null>(null);

  // Layer visibility
  const showCityCrimeLayer = selectedIndicator === 'kriminalstatistik';
  const showBlaulichtLayer = selectedIndicator === 'blaulicht';
  const showKreisLayer = !showCityCrimeLayer && !showBlaulichtLayer;
  const shouldShowRankingPanel = !showBlaulichtLayer;

  // Fetch Blaulicht data (filtered by pipeline run if selected)
  const { data: blaulichtCrimes = [] } = useCrimes(undefined, selectedPipelineRun);
  const { data: pipelineRuns } = usePipelineRuns();

  // Compute stats from the fetched crimes (already filtered by pipeline run)
  const stats = useMemo(() => {
    const byCategory: Partial<Record<CrimeCategory, number>> = {};
    let geocoded = 0;
    for (const crime of blaulichtCrimes) {
      if (crime.latitude != null) geocoded++;
      for (const cat of crime.categories) {
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      }
    }
    return { total: blaulichtCrimes.length, geocoded, byCategory };
  }, [blaulichtCrimes]);

  const weaponCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const crime of blaulichtCrimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      if (selectedBlaulichtCategory && !crime.categories.includes(selectedBlaulichtCategory)) continue;
      const wt = crime.weaponType;
      if (wt && wt !== 'none' && wt !== 'unknown') {
        counts[wt] = (counts[wt] || 0) + 1;
      }
    }
    return counts;
  }, [blaulichtCrimes, selectedBlaulichtCategory]);

  const orderedBlaulichtCrimes = useMemo(() => {
    const filtered = blaulichtCrimes
      .filter((crime) => crime.latitude != null && crime.longitude != null)
      .filter((crime) => !selectedBlaulichtCategory || crime.categories.includes(selectedBlaulichtCategory))
      .filter((crime) => !selectedWeaponType || crime.weaponType === selectedWeaponType)
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
  }, [blaulichtCrimes, selectedBlaulichtCategory, selectedWeaponType, showFavoritesOnly, favoriteIds, dateFilterFrom, dateFilterTo]);

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

  // Reset view when closing mobile ranking panel
  useEffect(() => {
    const wasOpen = previousMobileRankingRef.current;
    const justClosed = wasOpen && !isMobileRankingOpen;

    if (justClosed && mapRef.current) {
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
  }, [isMobileRankingOpen]);

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
    setCurrentZoom(zoom);
    if (zoom <= KREIS_DESELECT_ZOOM_THRESHOLD) {
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
    for (const layer of style.layers) {
      if (layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']) {
        map.getMap().setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:de'], ['get', 'name']]);
      }
    }
  }, []);

  const handleLoad = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Switch all labels to German
    setMapLanguage(map);

    // Re-apply on style reload (e.g. tile re-fetch)
    map.getMap().on('styledata', () => setMapLanguage(map));

    const container = map.getContainer();
    const isMobile = container.clientWidth < 768;

    map.fitBounds(GERMANY_BOUNDS, {
      padding: {
        top: (isMobile ? 0.08 : 0.1) * container.clientHeight + (isMobile ? 60 : 0),
        bottom: (isMobile ? 0.08 : 0.1) * container.clientHeight + (isMobile ? 140 : 0),
        left: (isMobile ? 0.08 : 0.1) * container.clientWidth,
        right: (isMobile ? 0.08 : 0.1) * container.clientWidth,
      },
    });
  }, [setMapLanguage]);

  return (
    <div className="relative w-full h-full">
      <MapGL
        ref={mapRef}
        mapStyle={MAP_STYLE}
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
        touchZoomRotate={false}
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
            onClickKreis={setSelectedKreis}
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

        {/* Address search (pin marker renders inside map) */}
        <AddressSearch mapRef={mapRef} />
      </MapGL>

      {/* Mobile category bar */}
      <MobileCategoryBar
        selectedIndicator={selectedIndicator}
        onIndicatorChange={(indicator) => {
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
          setBlaulichtPlaybackIndex(null);
          setFlashingCrimeIds(new Set());
          setDateFilterFrom(null);
          setDateFilterTo(null);
          setIsMobileRankingOpen(false);
        }}
        onOpenSettings={() => setIsControlsExpanded(true)}
      />

      {/* Mobile controls backdrop */}
      {isControlsExpanded && (
        <div
          className="md:hidden fixed inset-0 z-[999] bg-black/30 backdrop-enter"
          onClick={() => setIsControlsExpanded(false)}
        />
      )}

      {/* Controls overlay */}
      <div
        className={`
          absolute z-[1000] transition-all duration-300 ease-in-out
          md:top-4 md:right-4 md:flex md:flex-col md:gap-3 md:w-[264px] md:max-w-[264px] md:opacity-100 md:translate-x-0
          ${isControlsExpanded
            ? 'top-16 right-3 left-3 opacity-100 translate-y-0 max-h-[calc(100vh-5rem)] overflow-y-auto md:max-h-none md:overflow-y-visible'
            : 'top-16 right-3 left-3 opacity-0 -translate-y-4 pointer-events-none md:pointer-events-auto md:opacity-100 md:translate-y-0'
          }
        `}
      >
        <LayerControl
          selectedIndicator={selectedIndicator}
          onIndicatorChange={(indicator) => {
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
            setBlaulichtPlaybackIndex(null);
            setFlashingCrimeIds(new Set());
            setDateFilterFrom(null);
            setDateFilterTo(null);
            setIsControlsExpanded(false);
            setIsMobileRankingOpen(false);
          }}
          selectedSubMetric={selectedSubMetric}
          onSubMetricChange={setSelectedSubMetric}
          selectedIndicatorYear={effectiveIndicatorYear}
          cityCrimeMetric={cityCrimeMetric}
          onCityCrimeMetricChange={setCityCrimeMetric}
          blaulichtStats={stats}
          selectedBlaulichtCategory={selectedBlaulichtCategory}
          onBlaulichtCategoryChange={handleBlaulichtCategoryChange}
          weaponCounts={weaponCounts}
          selectedWeaponType={selectedWeaponType}
          onWeaponTypeChange={handleWeaponTypeChange}
          favoritesCount={favoritesCount}
          showFavoritesOnly={showFavoritesOnly}
          onToggleFavoritesOnly={() => setShowFavoritesOnly((prev) => !prev)}
          blaulichtViewMode={blaulichtViewMode}
          onBlaulichtViewModeChange={setBlaulichtViewMode}
          pipelineRuns={pipelineRuns}
          selectedPipelineRun={selectedPipelineRun}
          onPipelineRunChange={setSelectedPipelineRun}
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
          cityCrimeData={cityCrimeData}
        />
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
          className="bottom-20 md:bottom-4"
        />
      )}

      {showBlaulichtLayer && (
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
          className="bottom-20 md:bottom-4"
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
          onMobileToggle={() => setIsMobileRankingOpen(!isMobileRankingOpen)}
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
    </div>
  );
}
