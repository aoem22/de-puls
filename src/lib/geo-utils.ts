/**
 * Shared point-in-polygon utilities for boundary geometry matching.
 *
 * Extracted from seo-queries.ts so both Supabase-backed queries and
 * the local Kreis lookup can reuse the same logic.
 */

import kreiseGeoJson from '../../lib/data/geo/kreise.json';

// ────────────────────────── Types ──────────────────────────

export type BoundaryPosition = [number, number];

export type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: BoundaryPosition[][] }
  | { type: 'MultiPolygon'; coordinates: BoundaryPosition[][][] };

export interface KreisMatch {
  ags: string;
  name: string;
}

// ────────────────────────── Parsing helpers ──────────────────────────

function parsePosition(value: unknown): BoundaryPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = value[0];
  const lat = value[1];
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function parseRing(value: unknown): BoundaryPosition[] | null {
  if (!Array.isArray(value)) return null;
  const ring = value
    .map(parsePosition)
    .filter((pos): pos is BoundaryPosition => pos !== null);
  return ring.length >= 3 ? ring : null;
}

// ────────────────────────── Geometry functions ──────────────────────────

export function normalizeBoundaryGeometry(geometry: unknown): BoundaryGeometry | null {
  if (!geometry || typeof geometry !== 'object') return null;

  const rawType = (geometry as { type?: unknown }).type;
  const rawCoordinates = (geometry as { coordinates?: unknown }).coordinates;

  if (rawType === 'Polygon') {
    if (!Array.isArray(rawCoordinates)) return null;
    const rings = rawCoordinates
      .map(parseRing)
      .filter((ring): ring is BoundaryPosition[] => ring !== null);
    return rings.length > 0 ? { type: 'Polygon', coordinates: rings } : null;
  }

  if (rawType === 'MultiPolygon') {
    if (!Array.isArray(rawCoordinates)) return null;
    const polygons = rawCoordinates
      .map((polygon) => {
        if (!Array.isArray(polygon)) return null;
        const rings = polygon
          .map(parseRing)
          .filter((ring): ring is BoundaryPosition[] => ring !== null);
        return rings.length > 0 ? rings : null;
      })
      .filter((polygon): polygon is BoundaryPosition[][] => polygon !== null);
    return polygons.length > 0 ? { type: 'MultiPolygon', coordinates: polygons } : null;
  }

  return null;
}

export function pointInRing(lon: number, lat: number, ring: BoundaryPosition[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const yCrosses = (yi > lat) !== (yj > lat);
    if (!yCrosses) continue;
    const denominator = yj - yi;
    if (denominator === 0) continue;
    const xCross = ((xj - xi) * (lat - yi)) / denominator + xi;
    if (lon < xCross) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, rings: BoundaryPosition[][]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

export function isPointInBoundary(lon: number, lat: number, boundary: BoundaryGeometry): boolean {
  if (boundary.type === 'Polygon') {
    return pointInPolygon(lon, lat, boundary.coordinates);
  }
  for (const polygon of boundary.coordinates) {
    if (pointInPolygon(lon, lat, polygon)) return true;
  }
  return false;
}

// ────────────────────────── Kreis lookup ──────────────────────────

interface KreisEntry {
  ags: string;
  name: string;
  geometry: BoundaryGeometry;
  // Bounding box for fast pre-check: [minLon, minLat, maxLon, maxLat]
  bbox: [number, number, number, number];
}

let kreisIndex: KreisEntry[] | null = null;

function computeBbox(geometry: BoundaryGeometry): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const rings = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function loadKreisIndex(): KreisEntry[] {
  if (kreisIndex) return kreisIndex;
  const features = (kreiseGeoJson as { features: Array<{ geometry: unknown; properties: { ags: string; name: string } }> }).features;
  kreisIndex = features
    .map((f) => {
      const geo = normalizeBoundaryGeometry(f.geometry);
      if (!geo) return null;
      return { ags: f.properties.ags, name: f.properties.name, geometry: geo, bbox: computeBbox(geo) };
    })
    .filter((entry): entry is KreisEntry => entry !== null);
  return kreisIndex;
}

export function findKreis(lon: number, lat: number): KreisMatch | null {
  for (const k of loadKreisIndex()) {
    // Fast bounding-box pre-check
    if (lon < k.bbox[0] || lon > k.bbox[2] || lat < k.bbox[1] || lat > k.bbox[3]) continue;
    if (isPointInBoundary(lon, lat, k.geometry)) return { ags: k.ags, name: k.name };
  }
  return null;
}
