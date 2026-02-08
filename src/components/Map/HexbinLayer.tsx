'use client';

import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import { latLngToCell, cellToBoundary } from 'h3-js';
import { scaleSqrt } from 'd3-scale';
import { interpolateYlOrRd } from 'd3-scale-chromatic';

import type { CrimeRecord } from '@/lib/types/crime';

export type BlaulichtViewMode = 'dots' | 'density' | 'both';

interface HexbinLayerProps {
  crimes: CrimeRecord[];
  currentZoom: number;
  visible: boolean;
  /** When true, render below the crime-circles layer */
  beforeCrimeCircles?: boolean;
}

/** Map zoom → H3 resolution (discrete steps to avoid constant recomputation) */
function zoomToH3Resolution(zoom: number): number {
  if (zoom <= 4) return 4;
  if (zoom <= 5) return 5;
  if (zoom <= 6.5) return 6;
  if (zoom <= 8) return 7;
  if (zoom <= 9.5) return 8;
  if (zoom <= 11) return 9;
  return 10;
}

export function HexbinLayer({
  crimes,
  currentZoom,
  visible,
  beforeCrimeCircles = false,
}: HexbinLayerProps) {
  const h3Resolution = zoomToH3Resolution(currentZoom);

  const geojson = useMemo(() => {
    if (!visible || crimes.length === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    // Aggregate crimes into H3 cells
    const cellCounts = new Map<string, number>();
    for (const crime of crimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      const cell = latLngToCell(crime.latitude, crime.longitude, h3Resolution);
      cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1);
    }

    if (cellCounts.size === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    // Build color scale — sqrt domain for better visual spread on skewed data
    const counts = Array.from(cellCounts.values());
    const maxCount = Math.max(...counts);
    const colorScale = scaleSqrt()
      .domain([0, maxCount])
      .range([0, 1])
      .clamp(true);

    // Build GeoJSON features
    const features = [];
    for (const [cell, count] of cellCounts) {
      // cellToBoundary returns [[lat, lng], ...] — flip to [lng, lat] for GeoJSON
      const boundary = cellToBoundary(cell);
      const ring = boundary.map(([lat, lng]) => [lng, lat]);
      // Close the ring
      ring.push(ring[0]);

      const t = colorScale(count);
      const color = interpolateYlOrRd(0.15 + t * 0.85); // Start at warm yellow, not white

      features.push({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring],
        },
        properties: {
          count,
          color,
        },
      });
    }

    return { type: 'FeatureCollection' as const, features };
  }, [crimes, h3Resolution, visible]);

  const fillStyle: LayerProps = useMemo(
    () => ({
      id: 'hexbin-fill',
      type: 'fill',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.55,
      },
      ...(beforeCrimeCircles ? { beforeId: 'crime-circles' } : {}),
    }),
    [beforeCrimeCircles],
  );

  const lineStyle: LayerProps = useMemo(
    () => ({
      id: 'hexbin-outline',
      type: 'line',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1,
        'line-opacity': 0.35,
      },
      ...(beforeCrimeCircles ? { beforeId: 'crime-circles' } : {}),
    }),
    [beforeCrimeCircles],
  );

  if (!visible) return null;

  return (
    <Source id="hexbin-density" type="geojson" data={geojson}>
      <Layer {...fillStyle} />
      <Layer {...lineStyle} />
    </Source>
  );
}
