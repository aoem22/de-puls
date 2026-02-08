'use client';

import { Marker } from 'react-map-gl/maplibre';

interface PulseMarkerOverlayProps {
  lat: number;
  lng: number;
  color?: string;
}

export function PulseMarkerOverlay({ lat, lng, color = '#3b82f6' }: PulseMarkerOverlayProps) {
  return (
    <Marker longitude={lng} latitude={lat} anchor="center">
      <div
        className="pulse-marker-container"
        style={{ '--pulse-color': color, width: 24, height: 24, position: 'relative' } as React.CSSProperties}
      >
        <div className="pulse-marker-ring" style={{ '--pulse-color': color } as React.CSSProperties} />
        <div
          className="pulse-marker-dot"
          style={{ '--pulse-color': color, background: color, boxShadow: `0 0 8px ${color}` } as React.CSSProperties}
        />
      </div>
    </Marker>
  );
}
