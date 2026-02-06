'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { LayerControl } from './LayerControl';
import { CityCrimeLayer } from './CityCrimeLayer';
import { KreisLayer } from './KreisLayer';
import type { KreisHoverInfo } from './KreisLayer';
import { KreisHoverCard } from './KreisHoverCard';
import { RankingPanel } from './RankingPanel';
import { CrimeLayer } from './CrimeLayer';
import { CitiesLayer } from './CitiesLayer';
import { GermanyBorder } from './GermanyBorder';
import { BlaulichtDetailPanel } from './BlaulichtDetailPanel';
import { TimelineFloatingControl } from './TimelineFloatingControl';
import { BlaulichtPlaybackControl } from './BlaulichtPlaybackControl';
import { PulseMarkerOverlay } from './PulseMarkerOverlay';
import { CRIME_CATEGORIES, type CrimeRecord } from '@/lib/types/crime';
import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import type { CrimeCategory } from '@/lib/types/crime';
import { useCrimes, useCrimeStats, useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta } from '@/lib/supabase';

// Tile layer URLs
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const FALLBACK_AUSLAENDER_YEARS = ['2024'];
const FALLBACK_CRIME_YEARS = ['2024'];

// Map view settings
const MIN_ZOOM = 6;
const MAX_ZOOM = 18;

// Germany-wide view settings
const GERMANY_CENTER: [number, number] = [51.1657, 10.4515];
const GERMANY_ZOOM = 6;

// Germany bounds - tighter fit to actual Germany extent
const GERMANY_BOUNDS: [[number, number], [number, number]] = [
  [47.27, 5.87],   // Southwest corner (near Basel)
  [55.06, 15.04],  // Northeast corner (near Szczecin)
];

// Zoom threshold for deselecting a Kreis (when zoomed out enough to see it fully)
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

// Component to track zoom level changes
function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleZoom = () => onZoomChange(map.getZoom());
    map.on('zoomend', handleZoom);
    onZoomChange(map.getZoom()); // Initial value
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

// Zoom map back out when leaving selected Kreis detail mode.
function KreisSelectionResetter({
  selectedKreis,
  enabled,
  germanyBounds,
}: {
  selectedKreis: string | null;
  enabled: boolean;
  germanyBounds: [[number, number], [number, number]];
}) {
  const map = useMap();
  const previousSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    const hadSelection = Boolean(previousSelectedRef.current);
    const leftSelectionMode = hadSelection && !selectedKreis;

    if (enabled && leftSelectionMode) {
      map.fitBounds(germanyBounds, { padding: [80, 80], maxZoom: GERMANY_ZOOM });
    }

    previousSelectedRef.current = selectedKreis;
  }, [enabled, selectedKreis, germanyBounds, map]);

  return null;
}

// Component to set initial map bounds
function MapInitializer({ germanyBounds }: { germanyBounds: [[number, number], [number, number]] }) {
  const map = useMap();

  useEffect(() => {
    // Calculate padding: 10% of viewport on each side
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding: L.PointTuple = [height * 0.1, width * 0.1];

    map.fitBounds(germanyBounds, {
      paddingTopLeft: [padding[1], padding[0]],
      paddingBottomRight: [padding[1], padding[0]],
    });

    // Expand maxBounds slightly so user can pan a bit but not lose Germany
    const expandedBounds: [[number, number], [number, number]] = [
      [germanyBounds[0][0] - 1, germanyBounds[0][1] - 1],
      [germanyBounds[1][0] + 1, germanyBounds[1][1] + 1],
    ];
    map.setMaxBounds(expandedBounds);
    map.setMinZoom(MIN_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function ChoroplethMap() {
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

  // Unified indicator state (Ausländer, Deutschlandatlas, or Kriminalstatistik)
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorKey>('auslaender');
  const [selectedSubMetric, setSelectedSubMetric] = useState<SubMetricKey>('total');
  const [selectedIndicatorYear, setSelectedIndicatorYear] = useState<string>('2024');
  const [isIndicatorPlaying, setIsIndicatorPlaying] = useState(false);

  // Compute available years for the currently selected indicator
  const indicatorYears = useMemo((): string[] => {
    if (selectedIndicator === 'auslaender') return auslaenderYears;
    if (selectedIndicator === 'kriminalstatistik') return crimeDataYears;
    if (selectedIndicator === 'blaulicht') return [];
    return [deutschlandatlasYear];
  }, [selectedIndicator, auslaenderYears, crimeDataYears, deutschlandatlasYear]);

  // Always use a valid year for fetch/rendering, even if metadata changed.
  const effectiveIndicatorYear = useMemo(() => {
    if (selectedIndicator === 'blaulicht') return '';
    if (indicatorYears.length === 0) return selectedIndicatorYear;
    if (indicatorYears.includes(selectedIndicatorYear)) return selectedIndicatorYear;
    return indicatorYears[indicatorYears.length - 1];
  }, [selectedIndicator, indicatorYears, selectedIndicatorYear]);

  // Fetch indicator data from Supabase
  const { data: ausData } = useAuslaenderData(
    selectedIndicator === 'auslaender' ? effectiveIndicatorYear : ''
  );
  const { data: datlasData } = useDeutschlandatlasData();
  const { data: cityCrimeData } = useCityCrimeData();

  // Crime-specific state (only used when selectedIndicator === 'kriminalstatistik')
  const [cityCrimeMetric, setCityCrimeMetric] = useState<'hz' | 'aq'>('hz');
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Kreis-specific state (used for auslaender and deutschlandatlas)
  const [hoveredKreis, setHoveredKreis] = useState<string | null>(null);
  const [selectedKreis, setSelectedKreis] = useState<string | null>(null);
  const [kreisHoverInfo, setKreisHoverInfo] = useState<KreisHoverInfo | null>(null);

  // Zoom level tracking for fade effects
  const [currentZoom, setCurrentZoom] = useState<number>(GERMANY_ZOOM);

  // Blaulicht crime state
  const [selectedCrime, setSelectedCrime] = useState<CrimeRecord | null>(null);
  const [hoveredCrime, setHoveredCrime] = useState<CrimeRecord | null>(null);
  const [selectedBlaulichtCategory, setSelectedBlaulichtCategory] = useState<CrimeCategory | null>(null);
  const [isBlaulichtPlaying, setIsBlaulichtPlaying] = useState(false);
  const [blaulichtPlaybackIndex, setBlaulichtPlaybackIndex] = useState<number | null>(null);
  const [flashingCrimeIds, setFlashingCrimeIds] = useState<Set<string>>(new Set());
  const [detailPanelFlashToken, setDetailPanelFlashToken] = useState(0);
  const flashTimeoutsRef = useRef<Map<string, number>>(new Map());

  // Determine which layer type to show based on indicator
  const showCityCrimeLayer = selectedIndicator === 'kriminalstatistik';
  const showBlaulichtLayer = selectedIndicator === 'blaulicht';
  const showKreisLayer = !showCityCrimeLayer && !showBlaulichtLayer;
  const shouldShowRankingPanel = !showBlaulichtLayer;

  // Fetch Blaulicht crime data from Supabase
  const { data: blaulichtCrimes = [] } = useCrimes();
  const { data: blaulichtStats } = useCrimeStats();

  // Default stats while loading
  const stats = blaulichtStats ?? { total: 0, geocoded: 0, byCategory: {} };

  // Geocoded Blaulicht crimes sorted from oldest to newest for timeline playback.
  const orderedBlaulichtCrimes = useMemo(() => {
    const filtered = blaulichtCrimes
      .filter((crime) => crime.latitude != null && crime.longitude != null)
      .filter((crime) => {
        if (!selectedBlaulichtCategory) return true;
        return crime.categories.includes(selectedBlaulichtCategory);
      });

    filtered.sort((left, right) => getCrimeTimestamp(left) - getCrimeTimestamp(right));
    return filtered;
  }, [blaulichtCrimes, selectedBlaulichtCategory]);

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
    return new Set(orderedBlaulichtCrimes.slice(0, clampedBlaulichtIndex + 1).map((crime) => crime.id));
  }, [showBlaulichtLayer, orderedBlaulichtCrimes, clampedBlaulichtIndex]);

  const crimeById = useMemo(() => {
    const map = new Map<string, CrimeRecord>();
    for (const crime of orderedBlaulichtCrimes) {
      map.set(crime.id, crime);
    }
    return map;
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

  // Indicator year playback animation
  useEffect(() => {
    if (!isIndicatorPlaying) return;
    if (indicatorYears.length <= 1) return;

    const interval = window.setInterval(() => {
      setSelectedIndicatorYear((current) => {
        const currentIndex = indicatorYears.indexOf(current);
        const nextIndex = (currentIndex + 1) % indicatorYears.length;
        return indicatorYears[nextIndex];
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [isIndicatorPlaying, indicatorYears]);

  // Clear pending flash timeouts on unmount.
  useEffect(() => {
    const timeoutRegistry = flashTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeoutRegistry.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutRegistry.clear();
    };
  }, []);

  // Timeline playback for Blaulicht points and synchronized press release panel.
  useEffect(() => {
    if (!showBlaulichtLayer || !isBlaulichtPlaying) return;
    if (orderedBlaulichtCrimes.length === 0) return;

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
        setDetailPanelFlashToken((token) => token + 1);

        setFlashingCrimeIds((previous) => {
          const next = new Set(previous);
          next.add(nextCrime.id);
          return next;
        });

        const existingTimeout = flashTimeoutsRef.current.get(nextCrime.id);
        if (existingTimeout) {
          window.clearTimeout(existingTimeout);
        }

        const timeoutId = window.setTimeout(() => {
          setFlashingCrimeIds((previous) => {
            if (!previous.has(nextCrime.id)) return previous;
            const next = new Set(previous);
            next.delete(nextCrime.id);
            return next;
          });
          flashTimeoutsRef.current.delete(nextCrime.id);
        }, BLAULICHT_FLASH_DURATION_MS);

        flashTimeoutsRef.current.set(nextCrime.id, timeoutId);
        return nextIndex;
      });
    }, BLAULICHT_PLAYBACK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [showBlaulichtLayer, isBlaulichtPlaying, orderedBlaulichtCrimes]);

  const handleZoomChange = useCallback((zoom: number) => {
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
    setIsBlaulichtPlaying(false);
    setBlaulichtPlaybackIndex(null);
    setSelectedCrime(null);
    setHoveredCrime(null);
    setFlashingCrimeIds(new Set());
  }, []);

  const handleBlaulichtScrub = useCallback((nextIndex: number) => {
    if (orderedBlaulichtCrimes.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(nextIndex, orderedBlaulichtCrimes.length - 1));
    const activeCrime = orderedBlaulichtCrimes[clampedIndex];
    setBlaulichtPlaybackIndex(clampedIndex);
    setIsBlaulichtPlaying(false);
    setHoveredCrime(null);
    setSelectedCrime(activeCrime ?? null);
  }, [orderedBlaulichtCrimes]);

  // Keep ranking panel mounted long enough to animate out when switching to Blaulicht.
  useEffect(() => {
    let rafId: number | null = null;
    let nestedRafId: number | null = null;
    let timeoutId: number | null = null;

    if (shouldShowRankingPanel) {
      rafId = window.requestAnimationFrame(() => {
        setShouldRenderRankingPanel(true);
        nestedRafId = window.requestAnimationFrame(() => {
          setIsRankingPanelVisible(true);
        });
      });
    } else {
      rafId = window.requestAnimationFrame(() => {
        setIsRankingPanelVisible(false);
        timeoutId = window.setTimeout(() => {
          setShouldRenderRankingPanel(false);
        }, 260);
      });
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (nestedRafId !== null) window.cancelAnimationFrame(nestedRafId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [shouldShowRankingPanel]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={GERMANY_CENTER}
        zoom={GERMANY_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={GERMANY_BOUNDS}
        maxBoundsViscosity={1.0}
        className="w-full h-full"
        zoomControl={false}
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url={DARK_TILES}
        />


        {/* Germany border with glow */}
        <GermanyBorder />

        {/* Progressive city labels */}
        <CitiesLayer currentZoom={currentZoom} />

        {/* Zoom tracker for fade effects */}
        <ZoomTracker onZoomChange={handleZoomChange} />

        {/* Reset view when leaving selected Kreis detail */}
        <KreisSelectionResetter
          selectedKreis={selectedKreis}
          enabled={showKreisLayer}
          germanyBounds={GERMANY_BOUNDS}
        />

        {/* Initial map bounds setup */}
        <MapInitializer germanyBounds={GERMANY_BOUNDS} />

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

        {/* Kreis indicator layer (Ausländer or Deutschlandatlas) */}
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

        {/* Blaulicht crime markers (when blaulicht indicator selected) */}
        {showBlaulichtLayer && (
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
          />
        )}

        {/* Pulse overlay for newly appeared crimes while playing */}
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
      </MapContainer>

      {/* Mobile controls backdrop */}
      {isControlsExpanded && (
        <div
          className="md:hidden fixed inset-0 z-[999] bg-black/30 backdrop-enter"
          onClick={() => setIsControlsExpanded(false)}
        />
      )}

      {/* Mobile toggle button */}
      <button
        onClick={() => setIsControlsExpanded(!isControlsExpanded)}
        className="md:hidden absolute top-3 right-3 z-[1001] bg-[#141414]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#262626] p-3 text-zinc-200 touch-feedback active:scale-95 transition-transform"
        aria-label="Toggle controls"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${isControlsExpanded ? 'rotate-90' : ''}`}
        >
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <line x1="2" x2="6" y1="14" y2="14" />
          <line x1="10" x2="14" y1="8" y2="8" />
          <line x1="18" x2="22" y1="16" y2="16" />
        </svg>
      </button>

      {/* Controls overlay */}
      <div
        className={`
          absolute z-[1000] transition-all duration-300 ease-in-out
          md:top-4 md:right-4 md:flex md:flex-col md:gap-3 md:w-[264px] md:max-w-[264px] md:opacity-100 md:translate-x-0
          ${isControlsExpanded
            ? 'top-16 right-3 left-3 opacity-100 translate-y-0'
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
            // Set appropriate defaults based on indicator type
            if (indicator === 'auslaender') {
              setSelectedSubMetric('total');
              setSelectedIndicatorYear(auslaenderYears[auslaenderYears.length - 1] ?? '2024');
            } else if (indicator === 'deutschlandatlas') {
              setSelectedSubMetric('kinder_bg'); // Default to child poverty
              setSelectedIndicatorYear(deutschlandatlasYear);
            } else if (indicator === 'kriminalstatistik') {
              setSelectedSubMetric('total');
              setSelectedIndicatorYear(crimeDataYears[crimeDataYears.length - 1] ?? '2024');
            } else if (indicator === 'blaulicht') {
              // Blaulicht has no sub-metrics or year selection
              setSelectedSubMetric('all');
              setSelectedIndicatorYear('');
            }
            // Clear selections when switching indicators
            setSelectedKreis(null);
            setSelectedCity(null);
            setSelectedCrime(null);
            setHoveredCrime(null);
            setSelectedBlaulichtCategory(null);
            setBlaulichtPlaybackIndex(null);
            setFlashingCrimeIds(new Set());
            setIsControlsExpanded(false);
            setIsMobileRankingOpen(false);
          }}
          selectedSubMetric={selectedSubMetric}
          onSubMetricChange={setSelectedSubMetric}
          selectedIndicatorYear={effectiveIndicatorYear}
          // Crime-specific props (only used when kriminalstatistik is selected)
          cityCrimeMetric={cityCrimeMetric}
          onCityCrimeMetricChange={setCityCrimeMetric}
          // Blaulicht stats and category filter
          blaulichtStats={stats}
          selectedBlaulichtCategory={selectedBlaulichtCategory}
          onBlaulichtCategoryChange={handleBlaulichtCategoryChange}
          // Data props for legends
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
          cityCrimeData={cityCrimeData}
        />
      </div>

      {/* Floating bottom-center timeline transport controls */}
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
          className={showKreisLayer ? 'bottom-20 md:bottom-4' : 'bottom-4'}
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
          className="bottom-4"
        />
      )}

      {/* Kreis hover card (custom positioned tooltip) - desktop only */}
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

      {/* Unified ranking/detail panel (right side) - shown for all non-blaulicht indicators */}
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

      {/* Blaulicht detail panel - shown when a crime is selected or hovered */}
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
        />
      )}
    </div>
  );
}
