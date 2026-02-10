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
  /** Insert layer before this layer ID so dots render below labels */
  beforeId?: string;
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
  beforeId,
}: CrimeLayerProps) {
  const { current: mapRef } = useMap();
  const onClickRef = useRef(onCrimeClick);
  const onHoverRef = useRef(onCrimeHover);
  const crimeByIdRef = useRef<Map<string, CrimeRecord>>(new Map());
  const previousVisibleCrimeIdsRef = useRef<Set<string> | null>(null);
  const previousSelectedCrimeIdRef = useRef<string | null>(null);
  const previousHoveredCrimeIdRef = useRef<string | null>(null);
  const previousFlashingCrimeIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onClickRef.current = onCrimeClick;
    onHoverRef.current = onCrimeHover;
  }, [onCrimeClick, onCrimeHover]);

  // Build GeoJSON FeatureCollection from crimes array
  const { geojson, crimeById, featureIdByCrimeId } = useMemo(() => {
    const crimeById = new Map<string, CrimeRecord>();
    const featureIdByCrimeId = new Map<string, number>();
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

      const featureId = hashId(crime.id);
      featureIdByCrimeId.set(crime.id, featureId);

      features.push({
        type: 'Feature' as const,
        id: featureId,
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

    return {
      geojson: { type: 'FeatureCollection' as const, features },
      crimeById,
      featureIdByCrimeId,
    };
  }, [crimes, monochrome, filterCategory, favoriteIds]);

  useEffect(() => {
    crimeByIdRef.current = crimeById;
  }, [crimeById]);

  // Reset local diff-tracking when source data changes.
  useEffect(() => {
    previousVisibleCrimeIdsRef.current = null;
    previousSelectedCrimeIdRef.current = null;
    previousHoveredCrimeIdRef.current = null;
    previousFlashingCrimeIdsRef.current = new Set();
  }, [geojson]);

  // Sync feature-state for visibility.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('crime-points')) return;

    const previousVisibleCrimeIds = previousVisibleCrimeIdsRef.current;

    if (visibleCrimeIds === null) {
      if (previousVisibleCrimeIds !== null) {
        for (const featureId of featureIdByCrimeId.values()) {
          map.setFeatureState({ source: 'crime-points', id: featureId }, { visible: true });
        }
      }
      previousVisibleCrimeIdsRef.current = null;
      return;
    }

    if (previousVisibleCrimeIds === null) {
      for (const [crimeId, featureId] of featureIdByCrimeId.entries()) {
        map.setFeatureState(
          { source: 'crime-points', id: featureId },
          { visible: visibleCrimeIds.has(crimeId) }
        );
      }
      previousVisibleCrimeIdsRef.current = new Set(visibleCrimeIds);
      return;
    }

    for (const crimeId of visibleCrimeIds) {
      if (previousVisibleCrimeIds.has(crimeId)) continue;
      const featureId = featureIdByCrimeId.get(crimeId);
      if (featureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: featureId }, { visible: true });
      }
    }

    for (const crimeId of previousVisibleCrimeIds) {
      if (visibleCrimeIds.has(crimeId)) continue;
      const featureId = featureIdByCrimeId.get(crimeId);
      if (featureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: featureId }, { visible: false });
      }
    }

    previousVisibleCrimeIdsRef.current = new Set(visibleCrimeIds);
  }, [geojson, visibleCrimeIds, mapRef, featureIdByCrimeId]);

  // Sync feature-state for selected crime.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('crime-points')) return;

    const previousSelectedCrimeId = previousSelectedCrimeIdRef.current;
    const nextSelectedCrimeId = selectedCrimeId ?? null;

    if (previousSelectedCrimeId && previousSelectedCrimeId !== nextSelectedCrimeId) {
      const previousFeatureId = featureIdByCrimeId.get(previousSelectedCrimeId);
      if (previousFeatureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: previousFeatureId }, { selected: false });
      }
    }

    if (nextSelectedCrimeId && previousSelectedCrimeId !== nextSelectedCrimeId) {
      const nextFeatureId = featureIdByCrimeId.get(nextSelectedCrimeId);
      if (nextFeatureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: nextFeatureId }, { selected: true });
      }
    }

    previousSelectedCrimeIdRef.current = nextSelectedCrimeId;
  }, [geojson, selectedCrimeId, mapRef, featureIdByCrimeId]);

  // Sync feature-state for hovered crime.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('crime-points')) return;

    const previousHoveredCrimeId = previousHoveredCrimeIdRef.current;
    const nextHoveredCrimeId = hoveredCrimeId ?? null;

    if (previousHoveredCrimeId && previousHoveredCrimeId !== nextHoveredCrimeId) {
      const previousFeatureId = featureIdByCrimeId.get(previousHoveredCrimeId);
      if (previousFeatureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: previousFeatureId }, { hovered: false });
      }
    }

    if (nextHoveredCrimeId && previousHoveredCrimeId !== nextHoveredCrimeId) {
      const nextFeatureId = featureIdByCrimeId.get(nextHoveredCrimeId);
      if (nextFeatureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: nextFeatureId }, { hovered: true });
      }
    }

    previousHoveredCrimeIdRef.current = nextHoveredCrimeId;
  }, [geojson, hoveredCrimeId, mapRef, featureIdByCrimeId]);

  // Sync feature-state for flashing crimes.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !map.getSource('crime-points')) return;

    const nextFlashingCrimeIds = flashingCrimeIds ?? new Set<string>();
    const previousFlashingCrimeIds = previousFlashingCrimeIdsRef.current;

    for (const crimeId of previousFlashingCrimeIds) {
      if (nextFlashingCrimeIds.has(crimeId)) continue;
      const featureId = featureIdByCrimeId.get(crimeId);
      if (featureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: featureId }, { flashing: false });
      }
    }

    for (const crimeId of nextFlashingCrimeIds) {
      if (previousFlashingCrimeIds.has(crimeId)) continue;
      const featureId = featureIdByCrimeId.get(crimeId);
      if (featureId !== undefined) {
        map.setFeatureState({ source: 'crime-points', id: featureId }, { flashing: true });
      }
    }

    previousFlashingCrimeIdsRef.current = new Set(nextFlashingCrimeIds);
  }, [geojson, flashingCrimeIds, mapRef, featureIdByCrimeId]);

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

    // Use bbox query instead of layer-specific click handler so small circles
    // are reliably tappable on mobile (finger covers ~40px, circles are ~5px)
    const TAP_PADDING = 15; // px around tap point
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { x, y } = e.point;
      const features = map.queryRenderedFeatures(
        [[x - TAP_PADDING, y - TAP_PADDING], [x + TAP_PADDING, y + TAP_PADDING]],
        { layers: ['crime-circles'] },
      );
      if (features.length === 0) return;
      e.originalEvent.stopPropagation();
      const feature = features[0];
      const crimeId = (feature.properties as { _crimeId: string })._crimeId;
      const crime = crimeByIdRef.current.get(crimeId);
      if (crime && onClickRef.current) onClickRef.current(crime);
    };

    map.on('mousemove', 'crime-circles', onMove);
    map.on('mouseleave', 'crime-circles', onLeave);
    map.on('click', onClick);

    return () => {
      map.off('mousemove', 'crime-circles', onMove);
      map.off('mouseleave', 'crime-circles', onLeave);
      map.off('click', onClick);
    };
  }, [mapRef, handleMouseMove, handleMouseLeave]);

  return (
    <Source id="crime-points" type="geojson" data={geojson}>
      <Layer beforeId={beforeId} {...circleStyle} />
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
