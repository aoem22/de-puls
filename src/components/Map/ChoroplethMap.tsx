'use client';

import { useState, useEffect } from 'react';
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
import type { CrimeRecord } from '@/lib/types/crime';
import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import type { CrimeCategory } from '@/lib/types/crime';
import { useCrimes, useCrimeStats, useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta } from '@/lib/supabase';

// Tile layer URLs
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const LABELS_TILES = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

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

  // Fetch dataset metadata (available years) from Supabase
  const { data: datasetMeta } = useAllDatasetMeta();

  // Derive year arrays from metadata (with fallbacks while loading)
  const auslaenderYears = datasetMeta?.auslaender?.years ?? ['2024'];
  const deutschlandatlasYear = datasetMeta?.deutschlandatlas?.years?.[0] ?? '2022';
  const crimeDataYears = datasetMeta?.kriminalstatistik?.years ?? ['2024'];

  // Unified indicator state (Ausländer, Deutschlandatlas, or Kriminalstatistik)
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorKey>('auslaender');
  const [selectedSubMetric, setSelectedSubMetric] = useState<SubMetricKey>('total');
  const [selectedIndicatorYear, setSelectedIndicatorYear] = useState<string>('2024');
  const [isIndicatorPlaying, setIsIndicatorPlaying] = useState(false);

  // Update initial year when metadata loads
  useEffect(() => {
    if (datasetMeta?.auslaender && selectedIndicator === 'auslaender') {
      const years = datasetMeta.auslaender.years;
      if (years.length > 0 && !years.includes(selectedIndicatorYear)) {
        setSelectedIndicatorYear(years[years.length - 1]);
      }
    }
  }, [datasetMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch indicator data from Supabase
  const { data: ausData } = useAuslaenderData(
    selectedIndicator === 'auslaender' ? selectedIndicatorYear : ''
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

  // Determine which layer type to show based on indicator
  const showCityCrimeLayer = selectedIndicator === 'kriminalstatistik';
  const showBlaulichtLayer = selectedIndicator === 'blaulicht';
  const showKreisLayer = !showCityCrimeLayer && !showBlaulichtLayer;

  // Fetch Blaulicht crime data from Supabase
  const { data: blaulichtCrimes = [] } = useCrimes();
  const { data: blaulichtStats } = useCrimeStats();

  // Default stats while loading
  const stats = blaulichtStats ?? { total: 0, geocoded: 0, byCategory: {} };

  // Get available years for current indicator
  const getIndicatorYears = (): string[] => {
    if (selectedIndicator === 'auslaender') return auslaenderYears;
    if (selectedIndicator === 'kriminalstatistik') return crimeDataYears;
    if (selectedIndicator === 'blaulicht') return []; // No year selection for blaulicht
    return [deutschlandatlasYear];
  };

  // Indicator year playback animation
  useEffect(() => {
    if (!isIndicatorPlaying) return;
    const years = getIndicatorYears();
    if (years.length <= 1) return;

    const interval = window.setInterval(() => {
      setSelectedIndicatorYear((current) => {
        const currentIndex = years.indexOf(current);
        const nextIndex = (currentIndex + 1) % years.length;
        return years[nextIndex];
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [isIndicatorPlaying, selectedIndicator]);

  // Deselect Kreis when zooming out past threshold (seeing full map again)
  useEffect(() => {
    if (selectedKreis && currentZoom <= KREIS_DESELECT_ZOOM_THRESHOLD) {
      setSelectedKreis(null);
    }
  }, [currentZoom, selectedKreis]);

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
        <ZoomTracker onZoomChange={setCurrentZoom} />

        {/* Initial map bounds setup */}
        <MapInitializer germanyBounds={GERMANY_BOUNDS} />

        {/* City crime layer (when kriminalstatistik is selected) */}
        {showCityCrimeLayer && (
          <CityCrimeLayer
            selectedCrimeType={selectedSubMetric as CrimeTypeKey}
            metric={cityCrimeMetric}
            selectedYear={selectedIndicatorYear}
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
            selectedYear={selectedIndicatorYear}
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
            crimes={blaulichtCrimes}
            monochrome
            onCrimeClick={setSelectedCrime}
            onCrimeHover={setHoveredCrime}
            selectedCrimeId={selectedCrime?.id}
            hoveredCrimeId={hoveredCrime?.id}
            filterCategory={selectedBlaulichtCategory}
          />
        )}
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
          md:top-4 md:right-4 md:flex md:flex-col md:gap-3 md:max-w-[220px] md:opacity-100 md:translate-x-0
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
            // Set appropriate defaults based on indicator type
            if (indicator === 'auslaender') {
              setSelectedSubMetric('total');
              setSelectedIndicatorYear(auslaenderYears[auslaenderYears.length - 1]);
            } else if (indicator === 'deutschlandatlas') {
              setSelectedSubMetric('kinder_bg'); // Default to child poverty
              setSelectedIndicatorYear(deutschlandatlasYear);
            } else if (indicator === 'kriminalstatistik') {
              setSelectedSubMetric('total');
              setSelectedIndicatorYear(crimeDataYears[crimeDataYears.length - 1]);
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
            setIsControlsExpanded(false);
            setIsMobileRankingOpen(false);
          }}
          selectedSubMetric={selectedSubMetric}
          onSubMetricChange={setSelectedSubMetric}
          indicatorYears={getIndicatorYears()}
          selectedIndicatorYear={selectedIndicatorYear}
          isIndicatorPlaying={isIndicatorPlaying}
          onToggleIndicatorPlay={() => setIsIndicatorPlaying((prev) => !prev)}
          onIndicatorYearChange={(year) => {
            setSelectedIndicatorYear(year);
            setIsIndicatorPlaying(false);
          }}
          // Crime-specific props (only used when kriminalstatistik is selected)
          cityCrimeMetric={cityCrimeMetric}
          onCityCrimeMetricChange={setCityCrimeMetric}
          // Blaulicht stats and category filter
          blaulichtStats={stats}
          selectedBlaulichtCategory={selectedBlaulichtCategory}
          onBlaulichtCategoryChange={setSelectedBlaulichtCategory}
          // Data props for legends
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
          cityCrimeData={cityCrimeData}
        />
      </div>

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
            selectedYear={selectedIndicatorYear}
            auslaenderData={ausData}
            deutschlandatlasData={datlasData}
          />
        )}
      </div>

      {/* Unified ranking/detail panel (right side) - shown for Kreis-level indicators */}
      {showKreisLayer && (
        <RankingPanel
          indicatorKey={selectedIndicator}
          subMetric={selectedSubMetric}
          selectedYear={selectedIndicatorYear}
          hoveredAgs={hoveredKreis}
          selectedAgs={selectedKreis}
          onHoverAgs={setHoveredKreis}
          onSelectAgs={setSelectedKreis}
          isMobileOpen={isMobileRankingOpen}
          onMobileToggle={() => setIsMobileRankingOpen(!isMobileRankingOpen)}
          auslaenderData={ausData}
          deutschlandatlasData={datlasData}
          deutschlandatlasYear={deutschlandatlasYear}
        />
      )}

      {/* Blaulicht detail panel - shown when a crime is selected or hovered */}
      {showBlaulichtLayer && (selectedCrime || hoveredCrime) && (
        <BlaulichtDetailPanel
          crime={selectedCrime || hoveredCrime!}
          onClose={() => {
            setSelectedCrime(null);
            setHoveredCrime(null);
          }}
          isPreview={!selectedCrime && !!hoveredCrime}
        />
      )}
    </div>
  );
}
