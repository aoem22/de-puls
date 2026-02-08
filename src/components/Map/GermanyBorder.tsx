'use client';

import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import germanyBoundary from '../../../lib/data/geo/germany-boundary.json';

/**
 * Darkens everything outside Germany so only Germany shows in full detail.
 * European borders/coastlines remain faintly visible through the overlay.
 *
 * Uses an inverted polygon: a world-covering rectangle with Germany's
 * polygons cut out as holes, rendered as a dark semi-transparent fill.
 */

const maskFillStyle: LayerProps = {
  id: 'germany-mask-fill',
  type: 'fill',
  paint: {
    'fill-color': '#0e0e0e',
    'fill-opacity': 0.92,
  },
};

const borderLineStyle: LayerProps = {
  id: 'germany-border-line',
  type: 'line',
  source: 'germany-border',
  paint: {
    'line-color': '#ffffff',
    'line-width': 1.5,
    'line-opacity': 0.6,
  },
};

export function GermanyBorder() {
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

    // Collect all exterior rings from the MultiPolygon as holes
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
      {/* Dark overlay with Germany cut out — renders above labels to hide them outside Germany */}
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
