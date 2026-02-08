'use client';

import { useMemo, useCallback, useEffect, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { LayerProps, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';

import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface CrimeLayerProps {
  crimes: CrimeRecord[];
  monochrome?: boolean;
  onCrimeClick?: (crime: CrimeRecord) => void;
  onCrimeHover?: (crime: CrimeRecord | null) => void;
  selectedCrimeId?: string | null;
  hoveredCrimeId?: string | null;
  filterCategory?: CrimeCategory | null;
  visibleCrimeIds?: Set<string> | null;
  flashingCrimeIds?: Set<string> | null;
  favoriteIds?: Set<string>;
}

const categoryColorMap = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((c) => [c.key, c.color])
);

const DEFAULT_BLUE = '#3b82f6';

// ── Component ───────────────────────────────────────────────────

export function CrimeLayer({
  crimes,
  monochrome = false,
  onCrimeClick,
  onCrimeHover,
  selectedCrimeId,
  hoveredCrimeId,
  filterCategory = null,
  visibleCrimeIds = null,
  flashingCrimeIds = null,
  favoriteIds,
}: CrimeLayerProps) {
  const { current: mapRef } = useMap();
  const onClickRef = useRef(onCrimeClick);
  const onHoverRef = useRef(onCrimeHover);
  const crimeByIdRef = useRef<Map<string, CrimeRecord>>(new Map());

  useEffect(() => {
    onClickRef.current = onCrimeClick;
    onHoverRef.current = onCrimeHover;
  }, [onCrimeClick, onCrimeHover]);

  // Build GeoJSON FeatureCollection from crimes array
  const geojson = useMemo(() => {
    const crimeById = new Map<string, CrimeRecord>();
    const features = [];

    for (const crime of crimes) {
      if (crime.latitude == null || crime.longitude == null) continue;
      if (filterCategory !== null && !crime.categories.includes(filterCategory)) continue;
      // Hide non-primary records in grouped incidents (they show in detail timeline)
      if (crime.groupRole && crime.groupRole !== 'primary' && crime.incidentGroupId) continue;

      crimeById.set(crime.id, crime);

      const category = crime.categories[0] ?? 'other';
      const isFav = favoriteIds?.has(crime.id) ?? false;
      const color = isFav
        ? '#f59e0b'
        : monochrome
          ? (filterCategory !== null ? (categoryColorMap.get(category) ?? DEFAULT_BLUE) : DEFAULT_BLUE)
          : (categoryColorMap.get(category) ?? '#94a3b8');

      features.push({
        type: 'Feature' as const,
        id: hashId(crime.id),
        geometry: {
          type: 'Point' as const,
          coordinates: [crime.longitude, crime.latitude],
        },
        properties: {
          _crimeId: crime.id,
          _color: color,
        },
      });
    }

    crimeByIdRef.current = crimeById;
    return { type: 'FeatureCollection' as const, features };
  }, [crimes, monochrome, filterCategory, favoriteIds]);

  // Sync feature-state for visibility, selection, hover, flash
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('crime-points')) return;

    for (const feature of geojson.features) {
      const crimeId = feature.properties._crimeId;
      const numId = feature.id as number;
      const isVisible = visibleCrimeIds === null || visibleCrimeIds.has(crimeId);
      const isSelected = crimeId === selectedCrimeId;
      const isHovered = crimeId === hoveredCrimeId;
      const isFlashing = flashingCrimeIds?.has(crimeId) ?? false;

      map.setFeatureState(
        { source: 'crime-points', id: numId },
        {
          visible: isVisible,
          selected: isSelected,
          hovered: isHovered,
          flashing: isFlashing,
        }
      );
    }
  }, [geojson, visibleCrimeIds, selectedCrimeId, hoveredCrimeId, flashingCrimeIds, mapRef]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const crimeId = (feature.properties as { _crimeId: string })._crimeId;
    const crime = crimeByIdRef.current.get(crimeId);
    if (crime && onClickRef.current) onClickRef.current(crime);
  }, []);

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const crimeId = (feature.properties as { _crimeId: string })._crimeId;
    const crime = crimeByIdRef.current.get(crimeId);
    if (crime && onHoverRef.current) onHoverRef.current(crime);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (onHoverRef.current) onHoverRef.current(null);
  }, []);

  const circleStyle: LayerProps = useMemo(() => ({
    id: 'crime-circles',
    type: 'circle',
    paint: {
      // Single top-level interpolate (MapLibre GL allows only one zoom-based interpolation per expression)
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        5, ['case',
          ['!', ['boolean', ['feature-state', 'visible'], true]], 0,
          ['boolean', ['feature-state', 'selected'], false], 4.3,
          ['any', ['boolean', ['feature-state', 'hovered'], false], ['boolean', ['feature-state', 'flashing'], false]], 3.5,
          2.3,
        ],
        8, ['case',
          ['!', ['boolean', ['feature-state', 'visible'], true]], 0,
          ['boolean', ['feature-state', 'selected'], false], 5.4,
          ['any', ['boolean', ['feature-state', 'hovered'], false], ['boolean', ['feature-state', 'flashing'], false]], 4.6,
          3.4,
        ],
        11, ['case',
          ['!', ['boolean', ['feature-state', 'visible'], true]], 0,
          ['boolean', ['feature-state', 'selected'], false], 7.6,
          ['any', ['boolean', ['feature-state', 'hovered'], false], ['boolean', ['feature-state', 'flashing'], false]], 6.1,
          4.9,
        ],
        12, ['case',
          ['!', ['boolean', ['feature-state', 'visible'], true]], 0,
          ['boolean', ['feature-state', 'selected'], false], 7.6,
          ['any', ['boolean', ['feature-state', 'hovered'], false], ['boolean', ['feature-state', 'flashing'], false]], 6.1,
          5.6,
        ],
      ],
      'circle-color': ['get', '_color'],
      'circle-opacity': [
        'case',
        ['!', ['boolean', ['feature-state', 'visible'], true]],
        0,
        ['boolean', ['feature-state', 'flashing'], false],
        1,
        0.85,
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        2,
        ['any',
          ['boolean', ['feature-state', 'hovered'], false],
          ['boolean', ['feature-state', 'flashing'], false],
        ],
        2,
        1,
      ],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#ffffff',
        ['any',
          ['boolean', ['feature-state', 'hovered'], false],
          ['boolean', ['feature-state', 'flashing'], false],
        ],
        '#ffffff',
        monochrome ? ['get', '_color'] : 'rgba(255,255,255,0.5)',
      ],
      'circle-stroke-opacity': [
        'case',
        ['!', ['boolean', ['feature-state', 'visible'], true]],
        0,
        1,
      ],
    },
  }), [monochrome]);

  // Register event handlers on the map imperatively
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      handleMouseMove(e as unknown as MapLayerMouseEvent);
    };
    const onLeave = () => handleMouseLeave();
    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      handleClick(e as unknown as MapLayerMouseEvent);
    };

    map.on('mousemove', 'crime-circles', onMove);
    map.on('mouseleave', 'crime-circles', onLeave);
    map.on('click', 'crime-circles', onClick);

    return () => {
      map.off('mousemove', 'crime-circles', onMove);
      map.off('mouseleave', 'crime-circles', onLeave);
      map.off('click', 'crime-circles', onClick);
    };
  }, [mapRef, handleMouseMove, handleMouseLeave, handleClick]);

  return (
    <Source id="crime-points" type="geojson" data={geojson}>
      <Layer {...circleStyle} />
    </Source>
  );
}

// Simple numeric hash for feature IDs (MapLibre requires numeric IDs for feature-state)
function hashId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 32-bit integer
  }
  return Math.abs(hash);
}
