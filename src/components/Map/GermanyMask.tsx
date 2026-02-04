'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// Simplified Germany boundary coordinates (clockwise for hole)
const GERMANY_OUTLINE: [number, number][] = [
  [47.27, 5.87],
  [47.27, 7.5],
  [47.5, 10.2],
  [47.6, 13.0],
  [48.8, 13.8],
  [50.3, 12.1],
  [50.8, 14.8],
  [51.1, 15.0],
  [52.4, 14.7],
  [53.9, 14.2],
  [54.8, 13.4],
  [54.9, 9.9],
  [55.0, 8.3],
  [53.9, 8.9],
  [53.6, 7.2],
  [52.5, 7.0],
  [51.9, 6.0],
  [50.8, 6.0],
  [49.5, 6.4],
  [49.0, 8.2],
  [48.0, 7.8],
  [47.27, 5.87],
];

// European land bounds (rough rectangle covering visible Europe, excluding most sea)
const EUROPE_LAND_BOUNDS: [number, number][] = [
  // Western Europe land mass approximation
  [36.0, -10.0],  // Portugal/Spain
  [36.0, 30.0],   // Turkey
  [71.0, 30.0],   // Scandinavia
  [71.0, -10.0],  // Norway coast
  [36.0, -10.0],  // Back to start
];

interface GermanyMaskProps {
  fillColor?: string;
  fillOpacity?: number;
  showBorder?: boolean;
  borderColor?: string;
  borderWeight?: number;
}

export function GermanyMask({
  fillColor = '#0a0a0a',
  fillOpacity = 0.7,
  showBorder = false,
  borderColor = '#ffffff',
  borderWeight = 2,
}: GermanyMaskProps) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const layers: L.Layer[] = [];

    // Create inverted polygon: Europe land with Germany hole
    const europeRing = EUROPE_LAND_BOUNDS.map(([lat, lng]) => [lng, lat]);
    const germanyRing = GERMANY_OUTLINE.map(([lat, lng]) => [lng, lat]);

    const invertedPolygon = L.geoJSON(
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [europeRing, germanyRing],
        },
      } as GeoJSON.Feature,
      {
        style: {
          fillColor,
          fillOpacity,
          stroke: false,
          interactive: false,
        },
      }
    );

    invertedPolygon.addTo(map);
    invertedPolygon.bringToBack();
    layers.push(invertedPolygon);

    // Add glowing border around Germany if requested
    if (showBorder) {
      // Outer glow (larger, more transparent)
      const outerGlow = L.geoJSON(
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [germanyRing],
          },
        } as GeoJSON.Feature,
        {
          style: {
            fill: false,
            stroke: true,
            color: borderColor,
            weight: borderWeight + 6,
            opacity: 0.15,
            interactive: false,
          },
        }
      );
      outerGlow.addTo(map);
      layers.push(outerGlow);

      // Middle glow
      const middleGlow = L.geoJSON(
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [germanyRing],
          },
        } as GeoJSON.Feature,
        {
          style: {
            fill: false,
            stroke: true,
            color: borderColor,
            weight: borderWeight + 3,
            opacity: 0.3,
            interactive: false,
          },
        }
      );
      middleGlow.addTo(map);
      layers.push(middleGlow);

      // Main border (crisp white line)
      const mainBorder = L.geoJSON(
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [germanyRing],
          },
        } as GeoJSON.Feature,
        {
          style: {
            fill: false,
            stroke: true,
            color: borderColor,
            weight: borderWeight,
            opacity: 0.9,
            interactive: false,
          },
        }
      );
      mainBorder.addTo(map);
      layers.push(mainBorder);
    }

    return () => {
      layers.forEach(layer => map.removeLayer(layer));
    };
  }, [map, fillColor, fillOpacity, showBorder, borderColor, borderWeight]);

  return null;
}
