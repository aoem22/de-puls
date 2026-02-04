'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface CrimeLayerProps {
  crimes: CrimeRecord[];
  monochrome?: boolean; // When true, use dark dots with severity-based sizing
  onCrimeClick?: (crime: CrimeRecord) => void;
  selectedCrimeId?: string | null;
}

// Crime severity levels (higher = more severe = larger dot)
const CRIME_SEVERITY: Record<CrimeCategory, number> = {
  knife: 5,      // Most severe
  robbery: 4,
  assault: 4,
  arson: 3,
  burglary: 3,
  fraud: 2,
  traffic: 1,
  missing_person: 1,
  other: 1,      // Least severe
};

// Dot sizes based on severity (in pixels)
const SEVERITY_SIZES: Record<number, number> = {
  5: 16,  // Largest
  4: 14,
  3: 12,
  2: 10,
  1: 8,   // Smallest
};

const categoryColorMap = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((category) => [category.key, category.color])
);
const categoryLabelMap = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((category) => [category.key, category.label])
);

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getPrimaryCategory(crime: CrimeRecord): CrimeCategory {
  if (crime.categories.length > 0) return crime.categories[0];
  return 'other';
}

function getCrimeSeverity(crime: CrimeRecord): number {
  const category = getPrimaryCategory(crime);
  return CRIME_SEVERITY[category] ?? 1;
}

function formatCategories(categories: CrimeCategory[]): string {
  if (categories.length === 0) return 'Sonstiges';
  return categories
    .map((category) => categoryLabelMap.get(category) ?? category)
    .join(', ');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createPopupHtml(crime: CrimeRecord): string {
  const title = escapeHtml(crime.title);
  const dateText = escapeHtml(formatDate(crime.publishedAt));
  const locationText = crime.locationText ? escapeHtml(crime.locationText) : null;
  const summary = crime.summary ? escapeHtml(crime.summary) : null;
  const categories = escapeHtml(formatCategories(crime.categories));
  const precision = escapeHtml(crime.precision);
  const sourceUrl = escapeHtml(crime.sourceUrl);

  return `
    <div>
      <div style="font-size:14px;font-weight:600;">${title}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">${dateText}</div>
      ${locationText ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">Ort: ${locationText}</div>` : ''}
      ${summary ? `<div style="font-size:12px;color:#374151;margin-top:6px;">${summary}</div>` : ''}
      <div style="font-size:11px;color:#6b7280;margin-top:6px;">Kategorie: ${categories}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px;">Präzision: ${precision}</div>
      <a href="${sourceUrl}" target="_blank" rel="noreferrer" style="display:inline-block;font-size:11px;color:#06b6d4;margin-top:6px;">
        Quelle öffnen
      </a>
    </div>
  `;
}

function createMarker(
  crime: CrimeRecord,
  monochrome: boolean,
  isSelected: boolean,
  onClick?: (crime: CrimeRecord) => void
): L.Marker | null {
  if (crime.latitude == null || crime.longitude == null) return null;

  const category = getPrimaryCategory(crime);
  const severity = getCrimeSeverity(crime);
  const baseSize = SEVERITY_SIZES[severity] ?? 10;
  // Make selected marker larger
  const size = isSelected ? baseSize * 1.4 : baseSize;
  const halfSize = size / 2;

  // Monochrome: dark blue with glow effect
  // Colored: category-based colors
  const color = monochrome ? '#1e3a5f' : (categoryColorMap.get(category) ?? '#94a3b8');
  const glowColor = isSelected ? '#60a5fa' : '#3b82f6'; // Brighter blue when selected
  const borderColor = monochrome ? (isSelected ? '#60a5fa' : '#2563eb') : 'rgba(255,255,255,0.3)';

  const glowIntensity = isSelected ? 1.5 : 1;
  const glowStyle = monochrome
    ? `box-shadow:
        0 0 ${size * 0.5 * glowIntensity}px ${glowColor},
        0 0 ${size * glowIntensity}px ${glowColor}60,
        0 0 ${size * 1.5 * glowIntensity}px ${glowColor}30,
        inset 0 0 ${size * 0.3}px ${glowColor}60;
      cursor: pointer;`
    : `box-shadow: 0 1px 3px rgba(0,0,0,0.3); cursor: pointer;`;

  const icon = L.divIcon({
    className: 'crime-marker',
    html: `<span style="
      display:block;
      width:${size}px;
      height:${size}px;
      background:${color};
      border-radius:50%;
      border:${isSelected ? '2px' : '1px'} solid ${borderColor};
      ${glowStyle}
      transition: all 0.2s ease;
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [halfSize, halfSize],
  });

  const marker = L.marker([crime.latitude, crime.longitude], { icon });

  // Use click handler if provided (monochrome/blaulicht mode), otherwise use popup
  if (onClick && monochrome) {
    marker.on('click', () => onClick(crime));
  } else {
    marker.bindPopup(createPopupHtml(crime), { maxWidth: 260 });
  }

  return marker;
}

export function CrimeLayer({
  crimes,
  monochrome = false,
  onCrimeClick,
  selectedCrimeId,
}: CrimeLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.MarkerClusterGroup | L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;

    let layer: L.MarkerClusterGroup | L.LayerGroup;

    if (monochrome) {
      // No clustering in monochrome mode - show individual dots
      layer = L.layerGroup();
    } else {
      // Use clustering for colored mode
      layer = L.markerClusterGroup({
        showCoverageOnHover: false,
        chunkedLoading: true,
        maxClusterRadius: 48,
        disableClusteringAtZoom: 14,
      });
    }

    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map, monochrome]);

  const markers = useMemo(() => {
    return crimes
      .map((crime) => createMarker(crime, monochrome, crime.id === selectedCrimeId, onCrimeClick))
      .filter(Boolean) as L.Marker[];
  }, [crimes, monochrome, selectedCrimeId, onCrimeClick]);

  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.clearLayers();

    // Add markers to layer
    for (const marker of markers) {
      layerRef.current.addLayer(marker);
    }
  }, [markers]);

  return null;
}
