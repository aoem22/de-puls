'use client';

import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import germanyBoundary from '../../../lib/data/geo/germany-boundary.json';
import { useTheme } from '@/lib/theme';

/**
 * Masks everything outside Germany so only Germany shows in full detail.
 * Dark mode: dark overlay. Light mode: white overlay.
 *
 * Uses an inverted polygon: a world-covering rectangle with Germany's
 * polygons cut out as holes, rendered as a semi-transparent fill.
 */

export function GermanyBorder() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const maskFillStyle: LayerProps = useMemo(() => ({
    id: 'germany-mask-fill',
    type: 'fill' as const,
    paint: {
      'fill-color': isDark ? '#0e0e0e' : '#8a8a8f',
      'fill-opacity': isDark ? 0.92 : 0.3,
    },
  }), [isDark]);

  const borderLineStyle: LayerProps = useMemo(() => ({
    id: 'germany-border-line',
    type: 'line' as const,
    source: 'germany-border',
    paint: {
      'line-color': isDark ? '#ffffff' : '#9ca3af',
      'line-width': 1.5,
      'line-opacity': isDark ? 0.6 : 0.5,
    },
  }), [isDark]);

  const maskGeoJson = useMemo(() => {
    const worldRing: GeoJSON.Position[] = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ];

    const geometry = (germanyBoundary as unknown as GeoJSON.Feature<GeoJSON.MultiPolygon>)
      .geometry;

    const holes = geometry.coordinates.map((polygon) => polygon[0]);

    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [worldRing, ...holes],
      },
    };
  }, []);

  return (
    <>
      {/* Overlay with Germany cut out — dark in dark mode, white in light mode */}
      <Source id="germany-mask" type="geojson" data={maskGeoJson}>
        <Layer {...maskFillStyle} />
      </Source>

      {/* Subtle border line around Germany */}
      <Source
        id="germany-border"
        type="geojson"
        data={germanyBoundary as unknown as GeoJSON.Feature}
      >
        <Layer {...borderLineStyle} />
      </Source>
    </>
  );
}
