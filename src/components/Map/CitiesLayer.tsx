'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// German cities with population tiers for progressive display
// Tier 1: Major cities (always visible from zoom 6+)
// Tier 2: Large cities (visible from zoom 7+)
// Tier 3: Medium cities (visible from zoom 8+)
// Tier 4: Smaller cities (visible from zoom 9+)

interface City {
  name: string;
  lat: number;
  lng: number;
  tier: 1 | 2 | 3 | 4;
  population?: number;
}

const GERMAN_CITIES: City[] = [
  // Tier 1 - Major metropolises (>1M or state capitals)
  { name: 'Berlin', lat: 52.52, lng: 13.405, tier: 1, population: 3645000 },
  { name: 'Hamburg', lat: 53.5511, lng: 9.9937, tier: 1, population: 1841000 },
  { name: 'München', lat: 48.1351, lng: 11.582, tier: 1, population: 1472000 },
  { name: 'Köln', lat: 50.9375, lng: 6.9603, tier: 1, population: 1086000 },
  { name: 'Frankfurt', lat: 50.1109, lng: 8.6821, tier: 1, population: 753000 },

  // Tier 2 - Large cities (300k-1M)
  { name: 'Stuttgart', lat: 48.7758, lng: 9.1829, tier: 2, population: 635000 },
  { name: 'Düsseldorf', lat: 51.2277, lng: 6.7735, tier: 2, population: 619000 },
  { name: 'Leipzig', lat: 51.3397, lng: 12.3731, tier: 2, population: 593000 },
  { name: 'Dortmund', lat: 51.5136, lng: 7.4653, tier: 2, population: 588000 },
  { name: 'Essen', lat: 51.4556, lng: 7.0116, tier: 2, population: 583000 },
  { name: 'Bremen', lat: 53.0793, lng: 8.8017, tier: 2, population: 567000 },
  { name: 'Dresden', lat: 51.0504, lng: 13.7373, tier: 2, population: 556000 },
  { name: 'Hannover', lat: 52.3759, lng: 9.732, tier: 2, population: 538000 },
  { name: 'Nürnberg', lat: 49.4521, lng: 11.0767, tier: 2, population: 518000 },
  { name: 'Duisburg', lat: 51.4344, lng: 6.7623, tier: 2, population: 498000 },

  // Tier 3 - Medium cities (150k-300k)
  { name: 'Bochum', lat: 51.4818, lng: 7.2162, tier: 3, population: 365000 },
  { name: 'Wuppertal', lat: 51.2562, lng: 7.1508, tier: 3, population: 355000 },
  { name: 'Bielefeld', lat: 52.0302, lng: 8.5325, tier: 3, population: 334000 },
  { name: 'Bonn', lat: 50.7374, lng: 7.0982, tier: 3, population: 330000 },
  { name: 'Münster', lat: 51.9607, lng: 7.6261, tier: 3, population: 315000 },
  { name: 'Mannheim', lat: 49.4875, lng: 8.466, tier: 3, population: 310000 },
  { name: 'Karlsruhe', lat: 49.0069, lng: 8.4037, tier: 3, population: 308000 },
  { name: 'Augsburg', lat: 48.3705, lng: 10.8978, tier: 3, population: 296000 },
  { name: 'Wiesbaden', lat: 50.0782, lng: 8.2398, tier: 3, population: 278000 },
  { name: 'Mönchengladbach', lat: 51.1805, lng: 6.4428, tier: 3, population: 261000 },
  { name: 'Gelsenkirchen', lat: 51.5177, lng: 7.0857, tier: 3, population: 260000 },
  { name: 'Aachen', lat: 50.7753, lng: 6.0839, tier: 3, population: 249000 },
  { name: 'Braunschweig', lat: 52.2689, lng: 10.5268, tier: 3, population: 249000 },
  { name: 'Kiel', lat: 54.3233, lng: 10.1228, tier: 3, population: 247000 },
  { name: 'Chemnitz', lat: 50.8278, lng: 12.9214, tier: 3, population: 246000 },
  { name: 'Halle', lat: 51.4969, lng: 11.9688, tier: 3, population: 239000 },
  { name: 'Magdeburg', lat: 52.1205, lng: 11.6276, tier: 3, population: 236000 },
  { name: 'Freiburg', lat: 47.999, lng: 7.8421, tier: 3, population: 231000 },
  { name: 'Krefeld', lat: 51.3388, lng: 6.5853, tier: 3, population: 227000 },
  { name: 'Mainz', lat: 49.9929, lng: 8.2473, tier: 3, population: 218000 },
  { name: 'Lübeck', lat: 53.8655, lng: 10.6866, tier: 3, population: 217000 },
  { name: 'Erfurt', lat: 50.9848, lng: 11.0299, tier: 3, population: 214000 },
  { name: 'Rostock', lat: 54.0924, lng: 12.0991, tier: 3, population: 209000 },
  { name: 'Oberhausen', lat: 51.4963, lng: 6.8635, tier: 3, population: 210000 },

  // Tier 4 - Smaller notable cities (80k-150k)
  { name: 'Kassel', lat: 51.3127, lng: 9.4797, tier: 4, population: 202000 },
  { name: 'Hagen', lat: 51.3671, lng: 7.4633, tier: 4, population: 189000 },
  { name: 'Saarbrücken', lat: 49.2402, lng: 6.9969, tier: 4, population: 180000 },
  { name: 'Potsdam', lat: 52.3906, lng: 13.0645, tier: 4, population: 178000 },
  { name: 'Hamm', lat: 51.6739, lng: 7.8159, tier: 4, population: 179000 },
  { name: 'Ludwigshafen', lat: 49.4774, lng: 8.4452, tier: 4, population: 172000 },
  { name: 'Oldenburg', lat: 53.1435, lng: 8.2146, tier: 4, population: 169000 },
  { name: 'Osnabrück', lat: 52.2799, lng: 8.0472, tier: 4, population: 165000 },
  { name: 'Leverkusen', lat: 51.0459, lng: 6.9844, tier: 4, population: 164000 },
  { name: 'Heidelberg', lat: 49.3988, lng: 8.6724, tier: 4, population: 161000 },
  { name: 'Darmstadt', lat: 49.8728, lng: 8.6512, tier: 4, population: 159000 },
  { name: 'Solingen', lat: 51.1652, lng: 7.0671, tier: 4, population: 159000 },
  { name: 'Regensburg', lat: 49.0134, lng: 12.1016, tier: 4, population: 153000 },
  { name: 'Paderborn', lat: 51.7189, lng: 8.7544, tier: 4, population: 152000 },
  { name: 'Ingolstadt', lat: 48.7665, lng: 11.4258, tier: 4, population: 138000 },
  { name: 'Würzburg', lat: 49.7913, lng: 9.9534, tier: 4, population: 128000 },
  { name: 'Ulm', lat: 48.4011, lng: 9.9876, tier: 4, population: 126000 },
  { name: 'Göttingen', lat: 51.5413, lng: 9.9158, tier: 4, population: 119000 },
  { name: 'Wolfsburg', lat: 52.4227, lng: 10.7865, tier: 4, population: 124000 },
  { name: 'Heilbronn', lat: 49.1427, lng: 9.2109, tier: 4, population: 126000 },
  { name: 'Pforzheim', lat: 48.8922, lng: 8.6947, tier: 4, population: 125000 },
  { name: 'Reutlingen', lat: 48.4914, lng: 9.2043, tier: 4, population: 116000 },
  { name: 'Koblenz', lat: 50.3569, lng: 7.5890, tier: 4, population: 114000 },
  { name: 'Jena', lat: 50.9272, lng: 11.5892, tier: 4, population: 111000 },
  { name: 'Trier', lat: 49.7596, lng: 6.6439, tier: 4, population: 111000 },
  { name: 'Erlangen', lat: 49.5897, lng: 11.0078, tier: 4, population: 112000 },
  { name: 'Cottbus', lat: 51.7563, lng: 14.3329, tier: 4, population: 99000 },
  { name: 'Schwerin', lat: 53.6355, lng: 11.4012, tier: 4, population: 96000 },
];

// Zoom level thresholds for each tier
const TIER_ZOOM_THRESHOLDS: Record<number, number> = {
  1: 5,   // Major cities visible from zoom 5
  2: 7,   // Large cities from zoom 7
  3: 8,   // Medium cities from zoom 8
  4: 9,   // Smaller cities from zoom 9
};

// Font sizes based on tier
const TIER_FONT_SIZES: Record<number, number> = {
  1: 13,
  2: 11,
  3: 10,
  4: 9,
};

interface CitiesLayerProps {
  currentZoom: number;
}

export function CitiesLayer({ currentZoom }: CitiesLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;

    const layer = L.layerGroup();
    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!layerRef.current) return;

    layerRef.current.clearLayers();

    // Filter cities based on current zoom
    const visibleCities = GERMAN_CITIES.filter(
      (city) => currentZoom >= TIER_ZOOM_THRESHOLDS[city.tier]
    );

    // Create markers for visible cities
    for (const city of visibleCities) {
      const fontSize = TIER_FONT_SIZES[city.tier];
      const fontWeight = city.tier === 1 ? '600' : city.tier === 2 ? '500' : '400';
      const opacity = city.tier === 1 ? 1 : city.tier === 2 ? 0.9 : 0.8;

      const icon = L.divIcon({
        className: 'city-label',
        html: `<div style="
          color: rgba(255, 255, 255, ${opacity});
          font-size: ${fontSize}px;
          font-weight: ${fontWeight};
          text-shadow:
            0 0 4px rgba(0, 0, 0, 0.9),
            0 0 8px rgba(0, 0, 0, 0.7),
            1px 1px 2px rgba(0, 0, 0, 0.8);
          white-space: nowrap;
          pointer-events: none;
          letter-spacing: 0.02em;
        ">${city.name}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, fontSize / 2],
      });

      const marker = L.marker([city.lat, city.lng], {
        icon,
        interactive: false,
        zIndexOffset: 1000 - city.tier * 100, // Higher tiers appear on top
      });

      layerRef.current.addLayer(marker);
    }
  }, [currentZoom]);

  return null;
}
