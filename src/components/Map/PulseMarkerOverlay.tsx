'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface PulseMarkerOverlayProps {
  lat: number;
  lng: number;
  color?: string;
}

export function PulseMarkerOverlay({ lat, lng, color = '#3b82f6' }: PulseMarkerOverlayProps) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!map) return;

    const icon = L.divIcon({
      className: 'pulse-marker-container',
      html: `<div class="pulse-marker-ring" style="--pulse-color: ${color}"></div>
             <div class="pulse-marker-dot" style="--pulse-color: ${color}; background: ${color}; box-shadow: 0 0 8px ${color}"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([lat, lng], {
      icon,
      interactive: false,
      zIndexOffset: 1000,
    });

    marker.addTo(map);
    markerRef.current = marker;

    return () => {
      map.removeLayer(marker);
      markerRef.current = null;
    };
  }, [map, lat, lng, color]);

  return null;
}
