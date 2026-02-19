'use client';

import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import MapGL, { Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps, MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { GermanyBorder } from '../Map/GermanyBorder';
import { useTheme } from '@/lib/theme';

// ── Constants ────────────────────────────────────────────────

const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const GERMANY_CENTER_LNG = 10.4515;
const GERMANY_CENTER_LAT = 51.1657;
const MINI_MAP_ZOOM = 4.6;

const DOT_COLOR = '#3b82f6';
const DOT_HIGHLIGHT_COLOR = '#60a5fa';

// ── Types ────────────────────────────────────────────────────

export interface MiniMapPoint {
  lat: number;
  lon: number;
  groupKey: string;
}

interface DashboardMiniMapProps {
  points: MiniMapPoint[];
  hoveredKey: string | null;
  selectedKey: string | null;
  className?: string;
  onPointClick?: (pointIndex: number) => void;
}

// ── Component ────────────────────────────────────────────────

export function DashboardMiniMap({ points, hoveredKey, selectedKey, className, onPointClick }: DashboardMiniMapProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const mapRef = useRef<MapRef>(null);
  const prevSelectedRef = useRef<string | null>(null);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: points.map((pt, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { _groupKey: pt.groupKey },
      geometry: {
        type: 'Point' as const,
        coordinates: [pt.lon, pt.lat],
      },
    })),
  }), [points]);

  // Set feature-state for hover/selection highlighting
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('mini-dots');
    if (!source) return;

    const activeKey = selectedKey || hoveredKey;

    for (let i = 0; i < points.length; i++) {
      const gk = points[i].groupKey;
      // Highlight matching aggregate dots AND all feed dots (when zoomed in)
      const isMatch = activeKey
        ? gk === activeKey || gk.startsWith('feed:')
        : false;
      map.setFeatureState(
        { source: 'mini-dots', id: i },
        { highlighted: isMatch },
      );
    }
  }, [hoveredKey, selectedKey, points]);

  // Zoom to selected key's bounding box, or back to Germany
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (selectedKey && selectedKey !== prevSelectedRef.current) {
      const matching = points.filter((pt) => pt.groupKey === selectedKey);
      if (matching.length > 0) {
        if (matching.length === 1) {
          map.flyTo({
            center: [matching[0].lon, matching[0].lat],
            zoom: 11,
            duration: 800,
          });
        } else {
          let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
          for (const pt of matching) {
            if (pt.lat < minLat) minLat = pt.lat;
            if (pt.lat > maxLat) maxLat = pt.lat;
            if (pt.lon < minLng) minLng = pt.lon;
            if (pt.lon > maxLng) maxLng = pt.lon;
          }
          map.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 40, maxZoom: 13, duration: 800 },
          );
        }
      }
    } else if (!selectedKey && prevSelectedRef.current) {
      // Zoom back to Germany overview
      map.flyTo({
        center: [GERMANY_CENTER_LNG, GERMANY_CENTER_LAT],
        zoom: MINI_MAP_ZOOM,
        duration: 600,
      });
    }

    prevSelectedRef.current = selectedKey;
  }, [selectedKey, points]);

  // Determine active state for styling
  const hasActive = !!(selectedKey || hoveredKey);

  const circleStyle: LayerProps = useMemo(() => ({
    id: 'mini-dots-circle',
    type: 'circle' as const,
    paint: {
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'highlighted'], false],
        DOT_HIGHLIGHT_COLOR,
        DOT_COLOR,
      ] as unknown as string,
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'highlighted'], false],
        5,
        hasActive ? 2 : 3,
      ] as unknown as number,
      'circle-opacity': [
        'case',
        ['boolean', ['feature-state', 'highlighted'], false],
        1,
        hasActive ? 0.12 : 0.55,
      ] as unknown as number,
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'highlighted'], false],
        1,
        0,
      ] as unknown as number,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.4,
    },
  }), [hasActive]);

  // Click handler for dots
  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    if (!onPointClick) return;
    const feature = e.features?.[0];
    if (feature && feature.id != null) {
      onPointClick(feature.id as number);
    }
  }, [onPointClick]);

  // Cursor state for hovering over clickable dots
  const [hoverCursor, setHoverCursor] = useState(false);

  const handleMouseEnter = useCallback(() => setHoverCursor(true), []);
  const handleMouseLeave = useCallback(() => setHoverCursor(false), []);

  // Allow interaction when zoomed in (selected)
  const isZoomed = !!selectedKey;

  const cursorStyle = hoverCursor && onPointClick ? 'pointer' : isZoomed ? 'grab' : 'default';

  return (
    <div className={className} style={{ minHeight: 200 }}>
      <MapGL
        ref={mapRef}
        initialViewState={{
          longitude: GERMANY_CENTER_LNG,
          latitude: GERMANY_CENTER_LAT,
          zoom: MINI_MAP_ZOOM,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        scrollZoom={isZoomed}
        dragPan={isZoomed}
        dragRotate={false}
        doubleClickZoom={false}
        touchZoomRotate={isZoomed}
        touchPitch={false}
        keyboard={false}
        cursor={cursorStyle}
        attributionControl={false}
        interactiveLayerIds={onPointClick ? ['mini-dots-circle'] : undefined}
        onClick={onPointClick ? handleClick : undefined}
        onMouseEnter={onPointClick ? handleMouseEnter : undefined}
        onMouseLeave={onPointClick ? handleMouseLeave : undefined}
      >
        <GermanyBorder />
        <Source id="mini-dots" type="geojson" data={geojson}>
          <Layer {...circleStyle} />
        </Source>
      </MapGL>
    </div>
  );
}
