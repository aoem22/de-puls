'use client';

import { useMemo, useCallback, useRef, useEffect } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet';
import L from 'leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { scaleSequential } from 'd3-scale';

import type { CityData, CrimeTypeKey } from '../../../lib/types/cityCrime';
import { getCrimeTypeConfig } from '../../../lib/types/cityCrime';
import { interpolateCrimeRate, interpolateClearanceRate } from '../../../lib/utils/colorInterpolators';
import { formatNumber } from '../../../lib/utils/formatters';

// Import data statically
import cityCrimesJson from '../../../lib/data/city-crimes.json';
import citiesGeojsonJson from '../../../lib/data/cities-geojson.json';

const cityCrimes = cityCrimesJson as {
  years: string[];
  dataByYear: Record<string, Record<string, CityData>>;
  crimeTypes: Array<{ key: string; label: string; labelDe: string; category: string }>;
};
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
}

// Local formatNumber wrapper for tooltip HTML (takes non-null number)
function formatTooltipNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function getTooltipHtml(
  city: CityData,
  crimeType: CrimeTypeKey,
  metric: 'hz' | 'aq',
  year: string
): string {
  const crimeConfig = getCrimeTypeConfig(crimeType);
  const stats = city.crimes[crimeType];

  if (!stats) {
    return `
      <div style="padding: 12px; min-width: 180px;">
        <div style="font-weight: 700; color: #fff; font-size: 14px; border-bottom: 1px solid #444; padding-bottom: 8px; margin-bottom: 8px;">
          ${city.name}
        </div>
        <div style="color: #a1a1aa; font-size: 12px;">Keine Daten für ${year}</div>
      </div>
    `;
  }

  const mainValue = metric === 'hz' ? stats.hz : stats.aq;
  const mainUnit = metric === 'hz' ? 'pro 100.000' : '%';

  return `
    <div style="padding: 12px; min-width: 200px;">
      <div style="font-weight: 700; color: #fff; font-size: 14px; line-height: 1.3; border-bottom: 1px solid #444; padding-bottom: 8px; margin-bottom: 8px;">
        ${city.name} <span style="font-weight: 400; color: #71717a;">(${year})</span>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 2px;">${crimeConfig?.labelDe || crimeType}</div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span style="font-size: 18px; font-weight: 700; color: #fff;">${formatTooltipNumber(mainValue)}</span>
          <span style="font-size: 11px; color: #71717a;">${mainUnit}</span>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid #333;">
        <div>
          <div style="font-size: 10px; color: #71717a;">Fälle</div>
          <div style="font-size: 13px; color: #fff;">${formatTooltipNumber(stats.cases)}</div>
        </div>
        <div>
          <div style="font-size: 10px; color: #71717a;">${metric === 'hz' ? 'Aufklärung' : 'HZ'}</div>
          <div style="font-size: 13px; color: #fff;">${formatTooltipNumber(metric === 'hz' ? stats.aq : stats.hz)}${metric === 'hz' ? '%' : ''}</div>
        </div>
      </div>
    </div>
  `;
}

export function CityCrimeLayer({
  selectedCrimeType,
  metric,
  selectedYear,
  hoveredCity,
  onHoverCity,
  onClickCity,
  currentZoom,
  selectedCity,
}: CityCrimeLayerProps) {
  const map = useMap();
  const layersRef = useRef<Map<string, L.Layer>>(new Map());

  // Build city data map for the selected year
  const cityDataMap = useMemo(() => {
    const dataMap = new Map<string, CityData>();
    const yearData = cityCrimes.dataByYear[selectedYear] || {};
    for (const [ags, data] of Object.entries(yearData)) {
      dataMap.set(ags, data as CityData);
    }
    return dataMap;
  }, [selectedYear]);

  // Calculate color scale based on current metric - use all years for consistent scale
  const colorScale = useMemo(() => {
    const values: number[] = [];

    // Collect values across ALL years for consistent color scale
    for (const yearData of Object.values(cityCrimes.dataByYear)) {
      for (const city of Object.values(yearData)) {
        const stats = (city as CityData).crimes[selectedCrimeType];
        if (stats) {
          values.push(metric === 'hz' ? stats.hz : stats.aq);
        }
      }
    }

    if (values.length === 0) {
      return () => '#333333';
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    const interpolator = metric === 'hz' ? interpolateCrimeRate : interpolateClearanceRate;

    const scale = scaleSequential<string>()
      .domain([min, max])
      .interpolator(interpolator);

    return (value: number | null): string => {
      if (value === null) return '#333333';
      return scale(value);
    };
  }, [selectedCrimeType, metric]);

  // Style function for GeoJSON
  const getStyle = useCallback(
    (feature?: Feature<Geometry, { ags: string }>): PathOptions => {
      const ags = feature?.properties?.ags;
      if (!ags) {
        return {
          fillColor: '#333333',
          weight: 1,
          opacity: 0.8,
          color: '#1a1a1a',
          fillOpacity: 0.6,
        };
      }

      const city = cityDataMap.get(ags);
      const stats = city?.crimes[selectedCrimeType];
      const value = stats ? (metric === 'hz' ? stats.hz : stats.aq) : null;
      const fillColor = colorScale(value);

      const isHovered = hoveredCity === ags;
      const isSelected = selectedCity === ags;

      // Calculate if we're "zoomed in" relative to Germany view (threshold for fade effect)
      const isZoomedIn = currentZoom !== undefined && currentZoom >= 9;

      return {
        fillColor,
        weight: isSelected ? 3 : isHovered ? 2 : 1,
        opacity: 1,
        // Border uses fill color for selected elements to maintain visibility
        color: isSelected ? fillColor : isHovered ? '#ffffff' : 'rgba(255,255,255,0.2)',
        // Fade fill when selected AND zoomed in
        fillOpacity: isSelected
          ? (isZoomedIn ? 0.25 : 0.9)
          : (isHovered ? 0.9 : 0.75),
      };
    },
    [selectedCrimeType, metric, colorScale, hoveredCity, selectedCity, currentZoom, cityDataMap]
  );

  // Event handlers for features
  const onEachFeature = useCallback(
    (feature: Feature<Geometry, { ags: string; name: string }>, layer: Layer) => {
      const ags = feature.properties?.ags;
      if (!ags) return;

      const city = cityDataMap.get(ags);
      if (!city) return;

      // Store layer reference
      layersRef.current.set(ags, layer);

      // Bind tooltip
      (layer as L.Path).bindTooltip(getTooltipHtml(city, selectedCrimeType, metric, selectedYear), {
        sticky: true,
        direction: 'top',
        offset: [0, -10],
        opacity: 1,
        className: 'custom-tooltip',
      });

      // Mouse events
      layer.on({
        mouseover: (e: LeafletMouseEvent) => {
          onHoverCity(ags);
          e.target.bringToFront();
        },
        mouseout: () => {
          onHoverCity(null);
        },
        click: (e: LeafletMouseEvent) => {
          const target = e.target as L.GeoJSON;
          if (target.getBounds) {
            const bounds = target.getBounds();
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
          }
          onClickCity(ags);
        },
      });
    },
    [selectedCrimeType, metric, selectedYear, cityDataMap, onHoverCity, onClickCity, map]
  );

  // Update tooltips when crime type, metric, or year changes
  useEffect(() => {
    layersRef.current.forEach((layer, ags) => {
      const city = cityDataMap.get(ags);
      if (city && (layer as L.Path).getTooltip) {
        const tooltip = (layer as L.Path).getTooltip();
        if (tooltip) {
          tooltip.setContent(getTooltipHtml(city, selectedCrimeType, metric, selectedYear));
        }
      }
    });
  }, [selectedCrimeType, metric, selectedYear, cityDataMap]);

  return (
    <GeoJSON
      key={`city-crime-${selectedCrimeType}-${metric}-${selectedYear}`}
      data={citiesGeojson}
      style={getStyle}
      onEachFeature={onEachFeature}
    />
  );
}

// Export utilities for legend
export function getCityCrimeLegendStops(
  crimeType: CrimeTypeKey,
  metric: 'hz' | 'aq',
  numStops = 5
): { value: number; color: string; label: string }[] {
  const values: number[] = [];

  // Use all years for consistent legend
  for (const yearData of Object.values(cityCrimes.dataByYear)) {
    for (const city of Object.values(yearData)) {
      const stats = (city as CityData).crimes[crimeType];
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

// Export available years
export const CRIME_DATA_YEARS = cityCrimes.years;
