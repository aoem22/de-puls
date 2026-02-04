'use client';

import { useEffect, useMemo, useCallback, useRef } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Layer, LeafletMouseEvent } from 'leaflet';
import L from 'leaflet';
import { scaleQuantile } from 'd3-scale';
import { interpolateYlOrRd, interpolateRdYlGn } from 'd3-scale-chromatic';

import type { IndicatorKey, SubMetricKey, AuslaenderRegionKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import { INDICATORS, AUSLAENDER_REGION_META, DEUTSCHLANDATLAS_META, isDeutschlandatlasKey } from '../../../lib/indicators/types';

// Import Kreis geo data
import kreiseGeoJson from '../../../lib/data/geo/kreise.json';

// Import indicator data
import auslaenderData from '../../../lib/data/indicators/auslaender.json';
import deutschlandatlasData from '../../../lib/data/indicators/deutschlandatlas.json';

const kreise = kreiseGeoJson as FeatureCollection;

// Ausländer data types
interface RegionData {
  male: number | null;
  female: number | null;
  total: number | null;
}

interface AuslaenderRecord {
  ags: string;
  name: string;
  regions: Record<AuslaenderRegionKey, RegionData>;
}

interface AuslaenderDataset {
  meta: {
    years: string[];
  };
  data: Record<string, Record<string, AuslaenderRecord>>;
}

// Deutschlandatlas data types
interface DeutschlandatlasRecord {
  ags: string;
  name: string;
  indicators: Record<string, number | null>;
}

interface DeutschlandatlasDataset {
  meta: {
    year: string;
    indicatorKeys: string[];
    categories: string[];
  };
  data: Record<string, DeutschlandatlasRecord>;
}

const auslaender = auslaenderData as unknown as AuslaenderDataset;
const deutschlandatlas = deutschlandatlasData as unknown as DeutschlandatlasDataset;

interface HoverInfo {
  ags: string;
  name: string;
  mouseX: number;
  mouseY: number;
}

interface KreisLayerProps {
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  selectedYear: string;
  hoveredKreis: string | null;
  onHoverKreis: (ags: string | null) => void;
  onHoverInfo: (info: HoverInfo | null) => void;
  onClickKreis: (ags: string | null) => void;
  selectedKreis: string | null;
  currentZoom: number;
}

interface KreisFeatureProps {
  ags: string;
  name: string;
  bundesland: string;
}

/**
 * Get color scale for sequential data (Ausländer)
 * Uses sqrt scaling with 95th percentile cap to prevent outliers dominating
 */
function createSequentialColorScale(
  values: number[]
): (value: number | null) => string {
  if (values.length === 0) {
    return () => '#333';
  }

  // Sort to find percentiles
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  // Cap at 95th percentile - outliers like Berlin won't stretch the scale
  const p95Index = Math.floor(sorted.length * 0.95);
  const max = sorted[p95Index];

  // Use sqrt for additional compression
  const sqrtMin = Math.sqrt(min);
  const sqrtMax = Math.sqrt(max);

  return (value: number | null) => {
    if (value === null) return '#333';
    // Clamp value to the 95th percentile max
    const clampedValue = Math.min(value, max);
    const sqrtValue = Math.sqrt(clampedValue);
    const normalized = (sqrtValue - sqrtMin) / (sqrtMax - sqrtMin);
    const colorPosition = 0.1 + normalized * 0.9;
    return interpolateYlOrRd(colorPosition);
  };
}

/**
 * Get color scale for semantic data (Deutschlandatlas)
 * Uses red-yellow-green scale where direction depends on higherIsBetter
 */
function createSemanticColorScale(
  values: number[],
  higherIsBetter: boolean
): (value: number | null) => string {
  if (values.length === 0) {
    return () => '#333';
  }

  // RdYlGn goes from red (0) to green (1)
  const scale = scaleQuantile<string>()
    .domain(values)
    .range([0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0].map((t) => {
      // If higher is better, higher values should be green (t stays as is)
      // If higher is worse, invert the scale so higher values are red
      const adjustedT = higherIsBetter ? t : 1 - t;
      return interpolateRdYlGn(adjustedT);
    }));

  return (value: number | null) => {
    if (value === null) return '#333';
    return scale(value);
  };
}

/**
 * Get value for a Kreis based on indicator type
 */
function getValue(
  indicatorKey: IndicatorKey,
  subMetric: SubMetricKey,
  ags: string,
  year: string
): number | null {
  if (indicatorKey === 'auslaender') {
    const yearData = auslaender.data[year];
    if (!yearData) return null;
    const record = yearData[ags];
    if (!record) return null;
    return record.regions[subMetric as AuslaenderRegionKey]?.total ?? null;
  } else {
    // Deutschlandatlas - year is fixed (2022)
    const record = deutschlandatlas.data[ags];
    if (!record) return null;
    return record.indicators[subMetric] ?? null;
  }
}

/**
 * Get legend stops for the current indicator
 * For linear scales, shows evenly spaced values from min to max
 */
export function getKreisLegendStops(
  indicatorKey: IndicatorKey,
  subMetric: SubMetricKey,
  year: string,
  numStops: number = 5
): { value: number; color: string; label: string }[] {
  // Collect all values
  const values: number[] = [];

  if (indicatorKey === 'auslaender') {
    const yearData = auslaender.data[year];
    if (!yearData) return [];
    for (const record of Object.values(yearData)) {
      const regionData = record.regions[subMetric as AuslaenderRegionKey];
      if (regionData?.total !== null && regionData?.total !== undefined) {
        values.push(regionData.total);
      }
    }
  } else {
    // Deutschlandatlas
    for (const record of Object.values(deutschlandatlas.data)) {
      const value = record.indicators[subMetric];
      if (value !== null && value !== undefined) {
        values.push(value);
      }
    }
  }

  if (values.length === 0) return [];

  // Create appropriate color scale
  let colorScale: (value: number | null) => string;
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    const meta = DEUTSCHLANDATLAS_META[subMetric];
    if (meta.higherIsBetter !== undefined) {
      colorScale = createSemanticColorScale(values, meta.higherIsBetter);
    } else {
      colorScale = createSequentialColorScale(values);
    }
  } else {
    colorScale = createSequentialColorScale(values);
  }

  // Get unit for formatting
  const unit = indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)
    ? DEUTSCHLANDATLAS_META[subMetric].unitDe
    : '';

  // For sqrt scale with 95th percentile cap
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const p95Index = Math.floor(sorted.length * 0.95);
  const max = sorted[p95Index];
  const sqrtMin = Math.sqrt(min);
  const sqrtMax = Math.sqrt(max);

  const stops: { value: number; color: string; label: string }[] = [];
  for (let i = 0; i < numStops; i++) {
    // Interpolate in sqrt space, then square back to get actual values
    const sqrtValue = sqrtMin + (i / (numStops - 1)) * (sqrtMax - sqrtMin);
    const value = sqrtValue * sqrtValue;
    const formatted = value >= 1000
      ? value.toLocaleString('de-DE', { maximumFractionDigits: 0 })
      : value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
    stops.push({
      value,
      color: colorScale(value),
      label: unit ? `${formatted}` : formatted,
    });
  }

  return stops;
}

export type { HoverInfo as KreisHoverInfo };

export function KreisLayer({
  indicatorKey,
  subMetric,
  selectedYear,
  hoveredKreis,
  onHoverKreis,
  onHoverInfo,
  onClickKreis,
  selectedKreis,
  currentZoom,
}: KreisLayerProps) {
  const map = useMap();
  const layersRef = useRef<Map<string, L.Layer>>(new Map());
  const indicator = INDICATORS[indicatorKey];

  // Use ref to track selectedKreis for event handlers (avoids stale closure)
  const selectedKreisRef = useRef(selectedKreis);
  selectedKreisRef.current = selectedKreis;

  // Get all values for color scale calculation
  const allValues = useMemo(() => {
    const values: number[] = [];

    if (indicatorKey === 'auslaender') {
      const yearData = auslaender.data[selectedYear];
      if (!yearData) return values;
      for (const record of Object.values(yearData)) {
        const regionData = record.regions[subMetric as AuslaenderRegionKey];
        if (regionData?.total !== null && regionData?.total !== undefined) {
          values.push(regionData.total);
        }
      }
    } else {
      // Deutschlandatlas
      for (const record of Object.values(deutschlandatlas.data)) {
        const value = record.indicators[subMetric];
        if (value !== null && value !== undefined) {
          values.push(value);
        }
      }
    }

    return values;
  }, [indicatorKey, subMetric, selectedYear]);

  // Calculate color scale based on indicator type and sub-metric
  const colorScale = useMemo(() => {
    if (allValues.length === 0) {
      return () => '#333';
    }

    if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
      const meta = DEUTSCHLANDATLAS_META[subMetric];
      if (meta.higherIsBetter !== undefined) {
        return createSemanticColorScale(allValues, meta.higherIsBetter);
      }
    }

    return createSequentialColorScale(allValues);
  }, [allValues, indicatorKey, subMetric]);

  // Style function with zoom-based transparency
  const getStyle = useCallback(
    (feature?: Feature<Geometry, KreisFeatureProps>) => {
      if (!feature?.properties?.ags) {
        return {
          fillColor: '#333',
          weight: 1,
          opacity: 0.8,
          color: '#1a1a1a',
          fillOpacity: 0.5,
        };
      }

      const ags = feature.properties.ags;
      const value = getValue(indicatorKey, subMetric, ags, selectedYear);
      const isSelected = selectedKreis === ags;
      // Only show hover effect when no Kreis is selected (panel mode disables hover)
      const isHovered = !selectedKreis && hoveredKreis === ags;

      const fillColor = colorScale(value);

      // Calculate if we're "zoomed in" (threshold for fade effect)
      const isZoomedIn = currentZoom >= 9;

      return {
        fillColor,
        weight: isSelected ? 3 : isHovered ? 2 : 1,
        opacity: 1,
        color: isSelected ? fillColor : isHovered ? '#fff' : 'rgba(30,30,30,0.5)',
        // Fade fill when selected AND zoomed in
        fillOpacity: isSelected
          ? (isZoomedIn ? 0.25 : 0.9)
          : (isHovered ? 0.85 : 0.75),
      };
    },
    [indicatorKey, subMetric, selectedYear, colorScale, hoveredKreis, selectedKreis, currentZoom]
  );

  // Event handlers
  const onEachFeature = useCallback(
    (feature: Feature<Geometry, KreisFeatureProps>, layer: Layer) => {
      const ags = feature.properties?.ags;
      if (!ags) return;

      const kreisName = feature.properties.name;

      // Store layer reference
      layersRef.current.set(ags, layer);

      // Mouse events - use ref to get current selectedKreis value
      layer.on({
        mouseover: (e: LeafletMouseEvent) => {
          // Only show hover info if no Kreis is selected (use ref for current value)
          if (!selectedKreisRef.current) {
            onHoverKreis(ags);
            onHoverInfo({
              ags,
              name: kreisName,
              mouseX: e.originalEvent.clientX,
              mouseY: e.originalEvent.clientY,
            });
          }
          e.target.bringToFront();
        },
        mousemove: (e: LeafletMouseEvent) => {
          // Update mouse position for hover card
          if (!selectedKreisRef.current) {
            onHoverInfo({
              ags,
              name: kreisName,
              mouseX: e.originalEvent.clientX,
              mouseY: e.originalEvent.clientY,
            });
          }
        },
        mouseout: () => {
          onHoverKreis(null);
          onHoverInfo(null);
        },
        click: (e: LeafletMouseEvent) => {
          const currentSelected = selectedKreisRef.current;
          const isDeselecting = currentSelected === ags;
          onClickKreis(isDeselecting ? null : ags);

          // Zoom to the clicked Kreis bounds (like CityCrimeLayer)
          if (!isDeselecting) {
            const target = e.target as L.GeoJSON;
            if (target.getBounds) {
              const bounds = target.getBounds();
              map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
            }
          }
          e.target.bringToFront();
        },
      });
    },
    [onHoverKreis, onHoverInfo, onClickKreis, map]
  );

  // Clear hover info when a Kreis is selected (panel is shown instead)
  useEffect(() => {
    if (selectedKreis) {
      onHoverInfo(null);
    }
  }, [selectedKreis, onHoverInfo]);

  // Update layer styles when hover changes (for bidirectional hover with ranking panel)
  useEffect(() => {
    layersRef.current.forEach((layer, ags) => {
      const path = layer as L.Path;
      if (path.setStyle) {
        const isHovered = !selectedKreis && hoveredKreis === ags;
        const isSelected = selectedKreis === ags;
        const value = getValue(indicatorKey, subMetric, ags, selectedYear);
        const fillColor = colorScale(value);
        const isZoomedIn = currentZoom >= 9;

        path.setStyle({
          fillColor,
          weight: isSelected ? 3 : isHovered ? 2 : 1,
          opacity: 1,
          color: isSelected ? fillColor : isHovered ? '#fff' : 'rgba(30,30,30,0.5)',
          fillOpacity: isSelected
            ? (isZoomedIn ? 0.25 : 0.9)
            : (isHovered ? 0.85 : 0.75),
        });

        // Bring hovered layer to front
        if (isHovered && path.bringToFront) {
          path.bringToFront();
        }
      }
    });
  }, [hoveredKreis, selectedKreis, colorScale, indicatorKey, subMetric, selectedYear, currentZoom]);

  return (
    <GeoJSON
      key={`kreis-${indicatorKey}-${subMetric}-${selectedYear}`}
      data={kreise}
      style={getStyle}
      onEachFeature={onEachFeature}
    />
  );
}

// Export available years from Ausländer data
export const AUSLAENDER_YEARS = auslaender.meta.years;

// Export Deutschlandatlas year (single year dataset)
export const DEUTSCHLANDATLAS_YEAR = deutschlandatlas.meta.year;

// Export data for detail panel access
export { auslaender, deutschlandatlas };
