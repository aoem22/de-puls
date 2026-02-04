'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// Import Germany boundary GeoJSON
import germanyBoundary from '../../../lib/data/geo/germany-boundary.json';

export function GermanyBorder() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const layers: L.Layer[] = [];

    // Outer glow (largest, most transparent)
    const outerGlow = L.geoJSON(germanyBoundary as GeoJSON.Feature, {
      style: {
        fill: false,
        stroke: true,
        color: '#ffffff',
        weight: 10,
        opacity: 0.08,
        interactive: false,
      },
    });
    outerGlow.addTo(map);
    layers.push(outerGlow);

    // Middle glow
    const middleGlow = L.geoJSON(germanyBoundary as GeoJSON.Feature, {
      style: {
        fill: false,
        stroke: true,
        color: '#ffffff',
        weight: 5,
        opacity: 0.2,
        interactive: false,
      },
    });
    middleGlow.addTo(map);
    layers.push(middleGlow);

    // Main border (crisp white line)
    const mainBorder = L.geoJSON(germanyBoundary as GeoJSON.Feature, {
      style: {
        fill: false,
        stroke: true,
        color: '#ffffff',
        weight: 2,
        opacity: 0.85,
        interactive: false,
      },
    });
    mainBorder.addTo(map);
    layers.push(mainBorder);

    return () => {
      layers.forEach(layer => map.removeLayer(layer));
    };
  }, [map]);

  return null;
}
