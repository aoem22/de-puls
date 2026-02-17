'use client';

import { useMemo } from 'react';
import MapGL, { Layer, Source } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeocodePoint } from '@/lib/admin/types';
import { useTheme } from '@/lib/theme';

interface Props {
  label: string;
  points: GeocodePoint[];
  isHoveringDay: boolean;
}

const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const GERMANY_BOUNDS_SW_NE: [[number, number], [number, number]] = [
  [5.87, 47.27],
  [15.04, 55.06],
];

const POINT_LAYER: LayerProps = {
  id: 'geocode-day-points',
  type: 'circle',
  paint: {
    'circle-radius': 3,
    'circle-color': '#f97316',
    'circle-opacity': 0.72,
    'circle-stroke-color': '#fff',
    'circle-stroke-width': 0.5,
  },
};

export function GeocodeHoverMap({ label, points, isHoveringDay }: Props) {
  const { theme } = useTheme();
  const mapStyle = theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

  const data = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: points.map((point, idx) => ({
      type: 'Feature' as const,
      id: idx,
      geometry: {
        type: 'Point' as const,
        coordinates: [point.lon, point.lat] as [number, number],
      },
      properties: null,
    })),
  }), [points]);

  return (
    <div
      className="mt-3 overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
    >
      <div
        className="flex min-w-0 items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Day Map
        </span>
        <span className="truncate pl-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {label} · {points.length.toLocaleString('de-DE')} points
        </span>
      </div>

      <div className="mx-auto w-full max-w-[560px] aspect-[4/2]">
        {points.length > 0 ? (
          <MapGL
            mapStyle={mapStyle}
            initialViewState={{
              bounds: GERMANY_BOUNDS_SW_NE,
              fitBoundsOptions: {
                padding: {
                  top: 8,
                  right: 8,
                  bottom: 8,
                  left: 8,
                },
              },
            }}
            scrollZoom={false}
            boxZoom={false}
            dragPan={false}
            dragRotate={false}
            doubleClickZoom={false}
            touchZoomRotate={false}
            keyboard={false}
            interactive={false}
            attributionControl={false}
            style={{ width: '100%', height: '100%' }}
          >
            <Source id="geocode-day-points-source" type="geojson" data={data}>
              <Layer {...POINT_LAYER} />
            </Source>
          </MapGL>
        ) : (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--text-faint)' }}>
            {isHoveringDay ? 'No geocoded points for this day and filter.' : 'No geocoded points for the current filter.'}
          </div>
        )}
      </div>
    </div>
  );
}
