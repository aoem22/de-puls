'use client';

import { useMemo, useCallback, useEffect, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { LayerProps, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { scaleQuantile } from 'd3-scale';
import { interpolateYlOrRd, interpolateRdYlGn } from 'd3-scale-chromatic';
import bbox from '@turf/bbox';
import type maplibregl from 'maplibre-gl';

import type { IndicatorKey, SubMetricKey, AuslaenderRegionKey } from '../../../lib/indicators/types';
import { DEUTSCHLANDATLAS_META, isDeutschlandatlasKey } from '../../../lib/indicators/types';
import type { AuslaenderRow, DeutschlandatlasRow } from '@/lib/supabase';

import kreiseGeoJson from '../../../lib/data/geo/kreise.json';

const kreise = kreiseGeoJson as FeatureCollection;

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
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
}

// ── Color Scale Factories ───────────────────────────────────────

function createSequentialColorScale(
  values: number[]
): (value: number | null) => string {
  if (values.length === 0) return () => '#333';

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const p95Index = Math.floor(sorted.length * 0.95);
  const max = sorted[p95Index];
  const sqrtMin = Math.sqrt(min);
  const sqrtMax = Math.sqrt(max);

  return (value: number | null) => {
    if (value === null) return '#333';
    const clampedValue = Math.min(value, max);
    const sqrtValue = Math.sqrt(clampedValue);
    const normalized = (sqrtValue - sqrtMin) / (sqrtMax - sqrtMin);
    const colorPosition = 0.1 + normalized * 0.9;
    return interpolateYlOrRd(colorPosition);
  };
}

function createSemanticColorScale(
  values: number[],
  higherIsBetter: boolean
): (value: number | null) => string {
  if (values.length === 0) return () => '#333';

  const scale = scaleQuantile<string>()
    .domain(values)
    .range([0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0].map((t) => {
      const adjustedT = higherIsBetter ? t : 1 - t;
      return interpolateRdYlGn(adjustedT);
    }));

  return (value: number | null) => {
    if (value === null) return '#333';
    return scale(value);
  };
}

// ── Value Getter ────────────────────────────────────────────────

function getValue(
  indicatorKey: IndicatorKey,
  subMetric: SubMetricKey,
  ags: string,
  _year: string,
  ausData?: Record<string, AuslaenderRow>,
  datlasData?: Record<string, DeutschlandatlasRow>
): number | null {
  if (indicatorKey === 'auslaender') {
    if (!ausData) return null;
    const record = ausData[ags];
    if (!record) return null;
    return record.regions[subMetric as AuslaenderRegionKey]?.total ?? null;
  } else {
    if (!datlasData) return null;
    const record = datlasData[ags];
    if (!record) return null;
    return record.indicators[subMetric] ?? null;
  }
}

// ── Legend Export (unchanged logic) ──────────────────────────────

export function getKreisLegendStops(
  indicatorKey: IndicatorKey,
  subMetric: SubMetricKey,
  _year: string,
  numStops: number = 5,
  ausData?: Record<string, AuslaenderRow>,
  datlasData?: Record<string, DeutschlandatlasRow>
): { value: number; color: string; label: string }[] {
  const values: number[] = [];

  if (indicatorKey === 'auslaender') {
    if (!ausData) return [];
    for (const record of Object.values(ausData)) {
      const regionData = record.regions[subMetric as AuslaenderRegionKey];
      if (regionData?.total !== null && regionData?.total !== undefined) {
        values.push(regionData.total);
      }
    }
  } else {
    if (!datlasData) return [];
    for (const record of Object.values(datlasData)) {
      const value = record.indicators[subMetric];
      if (value !== null && value !== undefined) {
        values.push(value);
      }
    }
  }

  if (values.length === 0) return [];

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

  const unit = indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)
    ? DEUTSCHLANDATLAS_META[subMetric].unitDe
    : '';

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const p95Index = Math.floor(sorted.length * 0.95);
  const max = sorted[p95Index];
  const sqrtMin = Math.sqrt(min);
  const sqrtMax = Math.sqrt(max);

  const stops: { value: number; color: string; label: string }[] = [];
  for (let i = 0; i < numStops; i++) {
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

// ── Layer Paint Styles ──────────────────────────────────────────

const kreisFillStyle: LayerProps = {
  id: 'kreis-fill',
  type: 'fill',
  paint: {
    'fill-color': ['coalesce', ['get', '_fillColor'], '#333'],
    'fill-opacity': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      [
        'case',
        ['boolean', ['feature-state', 'zoomedIn'], false],
        0.25,
        0.9,
      ],
      ['boolean', ['feature-state', 'hovered'], false],
      0.85,
      0.75,
    ],
  },
};

const kreisLineStyle: LayerProps = {
  id: 'kreis-line',
  type: 'line',
  paint: {
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      ['coalesce', ['get', '_fillColor'], '#333'],
      ['boolean', ['feature-state', 'hovered'], false],
      '#ffffff',
      'rgba(30,30,30,0.5)',
    ],
    'line-width': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      3,
      ['boolean', ['feature-state', 'hovered'], false],
      2,
      1,
    ],
    'line-opacity': 1,
  },
};

// ── Component ───────────────────────────────────────────────────

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
  auslaenderData: ausData,
  deutschlandatlasData: datlasData,
}: KreisLayerProps) {
  const { current: mapRef } = useMap();
  const hoveredAgsRef = useRef<string | null>(null);
  const selectedKreisRef = useRef(selectedKreis);
  const isZoomedIn = currentZoom >= 9;

  useEffect(() => {
    selectedKreisRef.current = selectedKreis;
  }, [selectedKreis]);

  // Collect all values for color scale
  const allValues = useMemo(() => {
    const values: number[] = [];
    if (indicatorKey === 'auslaender') {
      if (!ausData) return values;
      for (const record of Object.values(ausData)) {
        const regionData = record.regions[subMetric as AuslaenderRegionKey];
        if (regionData?.total !== null && regionData?.total !== undefined) {
          values.push(regionData.total);
        }
      }
    } else {
      if (!datlasData) return values;
      for (const record of Object.values(datlasData)) {
        const value = record.indicators[subMetric];
        if (value !== null && value !== undefined) {
          values.push(value);
        }
      }
    }
    return values;
  }, [indicatorKey, subMetric, ausData, datlasData]);

  const colorScale = useMemo(() => {
    if (allValues.length === 0) return () => '#333';
    if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
      const meta = DEUTSCHLANDATLAS_META[subMetric];
      if (meta.higherIsBetter !== undefined) {
        return createSemanticColorScale(allValues, meta.higherIsBetter);
      }
    }
    return createSequentialColorScale(allValues);
  }, [allValues, indicatorKey, subMetric]);

  // Build GeoJSON with pre-computed fill colors injected into properties
  const enrichedGeoJson = useMemo(() => {
    const features = kreise.features.map((feature) => {
      const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
      const value = ags
        ? getValue(indicatorKey, subMetric, ags, selectedYear, ausData, datlasData)
        : null;
      const fillColor = colorScale(value);
      return {
        ...feature,
        id: ags ? parseInt(ags, 10) : undefined,
        properties: {
          ...feature.properties,
          _fillColor: fillColor,
        },
      };
    });
    return { type: 'FeatureCollection' as const, features };
  }, [kreise, indicatorKey, subMetric, selectedYear, ausData, datlasData, colorScale]);

  // Sync feature-state for hover
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('kreis-source')) return;

    // Clear old hover
    if (hoveredAgsRef.current) {
      map.setFeatureState(
        { source: 'kreis-source', id: parseInt(hoveredAgsRef.current, 10) },
        { hovered: false }
      );
    }
    // Set new hover
    if (hoveredKreis) {
      map.setFeatureState(
        { source: 'kreis-source', id: parseInt(hoveredKreis, 10) },
        { hovered: true }
      );
    }
    hoveredAgsRef.current = hoveredKreis;
  }, [hoveredKreis, mapRef]);

  // Sync feature-state for selection + zoomedIn
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('kreis-source')) return;

    // Reset all features' selected/zoomedIn state
    for (const feature of enrichedGeoJson.features) {
      const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
      if (!ags) continue;
      const numId = parseInt(ags, 10);
      map.setFeatureState(
        { source: 'kreis-source', id: numId },
        {
          selected: selectedKreis === ags,
          zoomedIn: isZoomedIn,
        }
      );
    }
  }, [selectedKreis, isZoomedIn, enrichedGeoJson, mapRef]);

  // Clear hover info when a Kreis is selected
  useEffect(() => {
    if (selectedKreis) {
      onHoverInfo(null);
    }
  }, [selectedKreis, onHoverInfo]);

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
    if (!ags) return;

    onHoverKreis(ags);

    if (!selectedKreisRef.current) {
      onHoverInfo({
        ags,
        name: (feature.properties as Record<string, unknown>)?.name as string ?? '',
        mouseX: e.point.x,
        mouseY: e.point.y,
      });
    }
  }, [onHoverKreis, onHoverInfo]);

  const handleMouseLeave = useCallback(() => {
    onHoverKreis(null);
    onHoverInfo(null);
  }, [onHoverKreis, onHoverInfo]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
    if (!ags) return;

    const isDeselecting = selectedKreisRef.current === ags;
    onClickKreis(isDeselecting ? null : ags);

    if (!isDeselecting && feature.geometry) {
      const bounds = bbox(feature.geometry);
      mapRef?.fitBounds(
        [bounds[0], bounds[1], bounds[2], bounds[3]] as [number, number, number, number],
        { padding: 50, maxZoom: 12 }
      );
    }
  }, [onClickKreis, mapRef]);

  // Register event handlers on the map imperatively
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      handleMouseMove(e as unknown as MapLayerMouseEvent);
    };
    const onLeave = () => handleMouseLeave();
    // Use padded hit-testing for reliable mobile taps near borders/small districts.
    const TAP_PADDING = 12;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { x, y } = e.point;
      const features = map.queryRenderedFeatures(
        [[x - TAP_PADDING, y - TAP_PADDING], [x + TAP_PADDING, y + TAP_PADDING]],
        { layers: ['kreis-fill'] },
      );
      if (features.length === 0) return;
      e.originalEvent.stopPropagation();
      handleClick({ ...(e as unknown as MapLayerMouseEvent), features } as MapLayerMouseEvent);
    };

    map.on('mousemove', 'kreis-fill', onMove);
    map.on('mouseleave', 'kreis-fill', onLeave);
    map.on('click', onClick);

    return () => {
      map.off('mousemove', 'kreis-fill', onMove);
      map.off('mouseleave', 'kreis-fill', onLeave);
      map.off('click', onClick);
    };
  }, [mapRef, handleMouseMove, handleMouseLeave, handleClick]);

  return (
    <Source id="kreis-source" type="geojson" data={enrichedGeoJson} promoteId="ags">
      <Layer {...kreisFillStyle} beforeId="germany-mask-fill" />
      <Layer {...kreisLineStyle} beforeId="germany-mask-fill" />
    </Source>
  );
}
