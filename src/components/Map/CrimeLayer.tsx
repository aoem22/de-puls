'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface CrimeLayerProps {
  crimes: CrimeRecord[];
  monochrome?: boolean; // When true, use dark dots with severity-based sizing
  onCrimeClick?: (crime: CrimeRecord) => void;
  onCrimeHover?: (crime: CrimeRecord | null) => void;
  selectedCrimeId?: string | null;
  hoveredCrimeId?: string | null;
  filterCategory?: CrimeCategory | null; // When set, highlight crimes in this category
}

const categoryColorMap = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((category) => [category.key, category.color])
);
const categoryLabelMap = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((category) => [category.key, category.label])
);

function getPrimaryCategory(crime: CrimeRecord): CrimeCategory {
  if (crime.categories.length > 0) return crime.categories[0];
  return 'other';
}

function formatCategories(categories: CrimeCategory[]): string {
  if (categories.length === 0) return 'Sonstiges';
  return categories
    .map((category) => categoryLabelMap.get(category) ?? category)
    .join(', ');
}

// Canvas-based CircleMarker style calculation
function getCircleMarkerStyle(
  crime: CrimeRecord,
  monochrome: boolean,
  isSelected: boolean,
  isHovered: boolean,
  filterCategory: CrimeCategory | null
): L.CircleMarkerOptions {
  const category = getPrimaryCategory(crime);
  const matchesFilter = filterCategory === null || crime.categories.includes(filterCategory);
  const categoryColor = categoryColorMap.get(category) ?? '#94a3b8';

  // Simple radius: slightly larger for selected/hovered
  const radius = isSelected ? 7 : isHovered ? 6 : 4;

  if (monochrome) {
    if (filterCategory !== null) {
      if (matchesFilter) {
        // Matching crimes: category color, fully visible
        return {
          radius,
          fillColor: categoryColor,
          fillOpacity: 0.9,
          color: categoryColor,
          weight: isSelected ? 2 : 1,
          opacity: 1,
        };
      } else {
        // Non-matching: dim gray
        return {
          radius: 3,
          fillColor: '#1a1a1a',
          fillOpacity: 0.3,
          color: '#333',
          weight: 1,
          opacity: 0.3,
        };
      }
    } else {
      // No filter: use category colors
      const isHighlighted = isSelected || isHovered;
      return {
        radius,
        fillColor: categoryColor,
        fillOpacity: 0.85,
        color: isHighlighted ? '#fff' : categoryColor,
        weight: isHighlighted ? 2 : 1,
        opacity: 1,
      };
    }
  } else {
    // Non-monochrome: category colors
    return {
      radius,
      fillColor: categoryColor,
      fillOpacity: 0.8,
      color: 'rgba(255,255,255,0.5)',
      weight: 1,
      opacity: 1,
    };
  }
}

export function CrimeLayer({
  crimes,
  monochrome = false,
  onCrimeClick,
  onCrimeHover,
  selectedCrimeId,
  hoveredCrimeId,
  filterCategory = null,
}: CrimeLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.FeatureGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const crimesMapRef = useRef<Map<L.CircleMarker, CrimeRecord>>(new Map());

  // Stable callback refs to avoid recreating markers on handler changes
  const onClickRef = useRef(onCrimeClick);
  const onHoverRef = useRef(onCrimeHover);
  onClickRef.current = onCrimeClick;
  onHoverRef.current = onCrimeHover;

  // Initialize feature group once
  useEffect(() => {
    if (!map) return;

    const layer = L.featureGroup();

    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      markersMapRef.current.clear();
      crimesMapRef.current.clear();
    };
  }, [map]);

  // Create markers once when crimes change (using canvas-based CircleMarkers)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    // Clear existing markers
    layer.clearLayers();
    markersMapRef.current.clear();
    crimesMapRef.current.clear();

    // Batch create all markers
    const markers: L.CircleMarker[] = [];

    for (const crime of crimes) {
      if (crime.latitude == null || crime.longitude == null) continue;

      const style = getCircleMarkerStyle(crime, monochrome, false, false, filterCategory);
      const marker = L.circleMarker([crime.latitude, crime.longitude], style);

      // Store crime reference for lookups
      markersMapRef.current.set(crime.id, marker);
      crimesMapRef.current.set(marker, crime);

      // Attach event handlers using refs (stable references)
      if (monochrome) {
        marker.on('click', () => {
          const crimeData = crimesMapRef.current.get(marker);
          if (crimeData && onClickRef.current) {
            onClickRef.current(crimeData);
          }
        });
        marker.on('mouseover', () => {
          const crimeData = crimesMapRef.current.get(marker);
          if (crimeData && onHoverRef.current) {
            onHoverRef.current(crimeData);
          }
        });
        marker.on('mouseout', () => {
          if (onHoverRef.current) {
            onHoverRef.current(null);
          }
        });
      } else {
        // Non-monochrome: bind popup
        const crimeData = crime;
        marker.bindPopup(() => {
          const cats = formatCategories(crimeData.categories);
          return `
            <div>
              <div style="font-size:14px;font-weight:600;">${crimeData.title}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:4px;">${crimeData.publishedAt}</div>
              ${crimeData.locationText ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">Ort: ${crimeData.locationText}</div>` : ''}
              ${crimeData.summary ? `<div style="font-size:12px;color:#374151;margin-top:6px;">${crimeData.summary}</div>` : ''}
              <div style="font-size:11px;color:#6b7280;margin-top:6px;">Kategorie: ${cats}</div>
              <a href="${crimeData.sourceUrl}" target="_blank" rel="noreferrer" style="display:inline-block;font-size:11px;color:#06b6d4;margin-top:6px;">
                Quelle öffnen
              </a>
            </div>
          `;
        }, { maxWidth: 260 });
      }

      markers.push(marker);
    }

    // Add all markers to feature group
    markers.forEach(m => layer.addLayer(m));
  }, [crimes, monochrome, filterCategory]);

  // Update styles for selected/hovered markers (without recreating)
  useEffect(() => {
    const markersMap = markersMapRef.current;
    const crimesMap = crimesMapRef.current;

    for (const [marker, crime] of crimesMap) {
      const isSelected = crime.id === selectedCrimeId;
      const isHovered = crime.id === hoveredCrimeId;
      const style = getCircleMarkerStyle(crime, monochrome, isSelected, isHovered, filterCategory);
      marker.setStyle(style);
      marker.setRadius(style.radius ?? 4);

      // Bring selected/hovered to front
      if (isSelected || isHovered) {
        marker.bringToFront();
      }
    }
  }, [selectedCrimeId, hoveredCrimeId, monochrome, filterCategory]);

  return null;
}
