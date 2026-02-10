'use client';

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Source, Layer, Popup, useMap } from 'react-map-gl/maplibre';
import type { LayerProps, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { scaleSequential } from 'd3-scale';
import bbox from '@turf/bbox';
import type maplibregl from 'maplibre-gl';

import type { CityData, CrimeTypeKey } from '../../../lib/types/cityCrime';
import { getCrimeTypeConfig } from '../../../lib/types/cityCrime';
import { interpolateCrimeRate, interpolateClearanceRate } from '../../../lib/utils/colorInterpolators';
import { formatNumber } from '../../../lib/utils/formatters';
import type { CityCrimeRow } from '@/lib/supabase';

import citiesGeojsonJson from '../../../lib/data/cities-geojson.json';

const citiesGeojson = citiesGeojsonJson as FeatureCollection;

interface CityCrimeLayerProps {
  selectedCrimeType: CrimeTypeKey;
  metric: 'hz' | 'aq';
  selectedYear: string;
  hoveredCity: string | null;
  onHoverCity: (ags: string | null) => void;
  onClickCity: (ags: string | null) => void;
  currentZoom?: number;
  selectedCity?: string | null;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
}

function formatTooltipNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

// ── Layer Paint Styles ──────────────────────────────────────────

const cityFillStyle: LayerProps = {
  id: 'city-crime-fill',
  type: 'fill',
  paint: {
    'fill-color': ['coalesce', ['get', '_fillColor'], '#333333'],
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
      0.9,
      0.75,
    ],
  },
};

const cityLineStyle: LayerProps = {
  id: 'city-crime-line',
  type: 'line',
  paint: {
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      ['coalesce', ['get', '_fillColor'], '#333333'],
      ['boolean', ['feature-state', 'hovered'], false],
      '#ffffff',
      'rgba(255,255,255,0.2)',
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

export function CityCrimeLayer({
  selectedCrimeType,
  metric,
  selectedYear,
  hoveredCity,
  onHoverCity,
  onClickCity,
  currentZoom,
  selectedCity,
  cityCrimeData,
}: CityCrimeLayerProps) {
  const { current: mapRef } = useMap();
  const hoveredAgsRef = useRef<string | null>(null);
  const isZoomedIn = currentZoom !== undefined && currentZoom >= 9;

  // Popup state
  const [popupInfo, setPopupInfo] = useState<{
    lng: number;
    lat: number;
    html: string;
  } | null>(null);

  // Build city data map for selected year
  const cityDataMap = useMemo(() => {
    const dataMap = new Map<string, CityData>();
    if (!cityCrimeData) return dataMap;
    const yearData = cityCrimeData[selectedYear] || {};
    for (const [ags, row] of Object.entries(yearData)) {
      dataMap.set(ags, { name: row.name, gemeindeschluessel: row.ags, crimes: row.crimes } as CityData);
    }
    return dataMap;
  }, [selectedYear, cityCrimeData]);

  // Color scale - consistent across all years
  const colorScale = useMemo(() => {
    const values: number[] = [];
    if (!cityCrimeData) return () => '#333333';

    for (const yearData of Object.values(cityCrimeData)) {
      for (const row of Object.values(yearData)) {
        const stats = row.crimes[selectedCrimeType];
        if (stats) {
          values.push(metric === 'hz' ? stats.hz : stats.aq);
        }
      }
    }

    if (values.length === 0) return () => '#333333';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const interpolator = metric === 'hz' ? interpolateCrimeRate : interpolateClearanceRate;
    const scale = scaleSequential<string>().domain([min, max]).interpolator(interpolator);

    return (value: number | null): string => {
      if (value === null) return '#333333';
      return scale(value);
    };
  }, [cityCrimeData, selectedCrimeType, metric]);

  // Build enriched GeoJSON with pre-computed colors
  const enrichedGeoJson = useMemo(() => {
    const features = citiesGeojson.features.map((feature) => {
      const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
      const city = ags ? cityDataMap.get(ags) : undefined;
      const stats = city?.crimes[selectedCrimeType];
      const value = stats ? (metric === 'hz' ? stats.hz : stats.aq) : null;
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
  }, [citiesGeojson, cityDataMap, selectedCrimeType, metric, colorScale]);

  // Sync hover feature-state
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('city-crime-source')) return;

    if (hoveredAgsRef.current) {
      map.setFeatureState(
        { source: 'city-crime-source', id: parseInt(hoveredAgsRef.current, 10) },
        { hovered: false }
      );
    }
    if (hoveredCity) {
      map.setFeatureState(
        { source: 'city-crime-source', id: parseInt(hoveredCity, 10) },
        { hovered: true }
      );
    }
    hoveredAgsRef.current = hoveredCity;
  }, [hoveredCity, mapRef]);

  // Sync selection + zoomedIn feature-state
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('city-crime-source')) return;

    for (const feature of enrichedGeoJson.features) {
      const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
      if (!ags) continue;
      map.setFeatureState(
        { source: 'city-crime-source', id: parseInt(ags, 10) },
        {
          selected: selectedCity === ags,
          zoomedIn: isZoomedIn,
        }
      );
    }
  }, [selectedCity, isZoomedIn, enrichedGeoJson, mapRef]);

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
    if (!ags) return;

    onHoverCity(ags);

    // Build tooltip popup
    const city = cityDataMap.get(ags);
    if (city) {
      const crimeConfig = getCrimeTypeConfig(selectedCrimeType);
      const stats = city.crimes[selectedCrimeType];
      let html: string;

      if (!stats) {
        html = `<div style="padding:12px;min-width:180px;"><div style="font-weight:700;color:#fff;font-size:14px;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;">${city.name}</div><div style="color:#a1a1aa;font-size:12px;">Keine Daten für ${selectedYear}</div></div>`;
      } else {
        const mainValue = metric === 'hz' ? stats.hz : stats.aq;
        const mainUnit = metric === 'hz' ? 'pro 100.000' : '%';
        html = `<div style="padding:12px;min-width:200px;"><div style="font-weight:700;color:#fff;font-size:14px;line-height:1.3;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:8px;">${city.name} <span style="font-weight:400;color:#71717a;">(${selectedYear})</span></div><div style="margin-bottom:8px;"><div style="font-size:11px;color:#a1a1aa;margin-bottom:2px;">${crimeConfig?.labelDe || selectedCrimeType}</div><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:18px;font-weight:700;color:#fff;">${formatTooltipNumber(mainValue)}</span><span style="font-size:11px;color:#71717a;">${mainUnit}</span></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:8px;border-top:1px solid #333;"><div><div style="font-size:10px;color:#71717a;">Fälle</div><div style="font-size:13px;color:#fff;">${formatTooltipNumber(stats.cases)}</div></div><div><div style="font-size:10px;color:#71717a;">${metric === 'hz' ? 'Aufklärung' : 'HZ'}</div><div style="font-size:13px;color:#fff;">${formatTooltipNumber(metric === 'hz' ? stats.aq : stats.hz)}${metric === 'hz' ? '%' : ''}</div></div></div></div>`;
      }

      setPopupInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, html });
    }
  }, [onHoverCity, cityDataMap, selectedCrimeType, metric, selectedYear]);

  const handleMouseLeave = useCallback(() => {
    onHoverCity(null);
    setPopupInfo(null);
  }, [onHoverCity]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ags = (feature.properties as Record<string, unknown>)?.ags as string | undefined;
    if (!ags) return;

    onClickCity(ags);
    setPopupInfo(null);

    if (feature.geometry) {
      const bounds = bbox(feature.geometry);
      mapRef?.fitBounds(
        [bounds[0], bounds[1], bounds[2], bounds[3]] as [number, number, number, number],
        { padding: 50, maxZoom: 12 }
      );
    }
  }, [onClickCity, mapRef]);

  // Register event handlers on the map imperatively
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      handleMouseMove(e as unknown as MapLayerMouseEvent);
    };
    const onLeave = () => handleMouseLeave();
    // Use padded hit-testing for reliable mobile taps around city polygons.
    const TAP_PADDING = 12;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { x, y } = e.point;
      const features = map.queryRenderedFeatures(
        [[x - TAP_PADDING, y - TAP_PADDING], [x + TAP_PADDING, y + TAP_PADDING]],
        { layers: ['city-crime-fill'] },
      );
      if (features.length === 0) return;
      e.originalEvent.stopPropagation();
      handleClick({ ...(e as unknown as MapLayerMouseEvent), features } as MapLayerMouseEvent);
    };

    map.on('mousemove', 'city-crime-fill', onMove);
    map.on('mouseleave', 'city-crime-fill', onLeave);
    map.on('click', onClick);

    return () => {
      map.off('mousemove', 'city-crime-fill', onMove);
      map.off('mouseleave', 'city-crime-fill', onLeave);
      map.off('click', onClick);
    };
  }, [mapRef, handleMouseMove, handleMouseLeave, handleClick]);

  return (
    <>
      <Source id="city-crime-source" type="geojson" data={enrichedGeoJson} promoteId="ags">
        <Layer {...cityFillStyle} beforeId="germany-mask-fill" />
        <Layer {...cityLineStyle} beforeId="germany-mask-fill" />
      </Source>

      {popupInfo && (
        <Popup
          longitude={popupInfo.lng}
          latitude={popupInfo.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={[0, -10] as [number, number]}
          className="city-crime-popup"
        >
          <div dangerouslySetInnerHTML={{ __html: popupInfo.html }} />
        </Popup>
      )}
    </>
  );
}

// Export utilities for legend (unchanged)
export function getCityCrimeLegendStops(
  crimeType: CrimeTypeKey,
  metric: 'hz' | 'aq',
  numStops = 5,
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>
): { value: number; color: string; label: string }[] {
  const values: number[] = [];

  if (!cityCrimeData) return [];

  for (const yearData of Object.values(cityCrimeData)) {
    for (const row of Object.values(yearData)) {
      const stats = row.crimes[crimeType];
      if (stats) {
        values.push(metric === 'hz' ? stats.hz : stats.aq);
      }
    }
  }

  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const interpolator = metric === 'hz' ? interpolateCrimeRate : interpolateClearanceRate;

  const scale = scaleSequential<string>()
    .domain([min, max])
    .interpolator(interpolator);

  const stops: { value: number; color: string; label: string }[] = [];
  const step = (max - min) / (numStops - 1);

  for (let i = 0; i < numStops; i++) {
    const value = min + i * step;
    stops.push({
      value,
      color: scale(value),
      label: formatNumber(value) + (metric === 'aq' ? '%' : ''),
    });
  }

  return stops;
}
