/**
 * Photon geocoding API (photon.komoot.io)
 * Free, no API key, excellent German address coverage.
 */

export interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    osm_id: number;
    osm_type: string;
    osm_key: string;
    osm_value: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    state?: string;
    country?: string;
    type?: string; // house, street, city, district, state, country
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

// Germany bounding box for filtering
const GERMANY_BBOX = '5.87,47.27,15.04,55.06';

export async function searchAddress(query: string, limit = 5): Promise<PhotonFeature[]> {
  if (!query || query.trim().length < 2) return [];

  const params = new URLSearchParams({
    q: query.trim(),
    limit: String(limit),
    bbox: GERMANY_BBOX,
    lang: 'de',
  });

  try {
    const response = await fetch(`https://photon.komoot.io/api/?${params}`);
    if (!response.ok) return [];
    const data: PhotonResponse = await response.json();
    return data.features ?? [];
  } catch {
    return [];
  }
}

export function formatPhotonResult(feature: PhotonFeature): string {
  const p = feature.properties;
  const parts: string[] = [];

  if (p.name && p.name !== p.city && p.name !== p.street) {
    parts.push(p.name);
  }

  if (p.street) {
    parts.push(p.housenumber ? `${p.street} ${p.housenumber}` : p.street);
  }

  if (p.postcode || p.city) {
    const cityPart = [p.postcode, p.city].filter(Boolean).join(' ');
    if (cityPart && !parts.includes(cityPart)) {
      parts.push(cityPart);
    }
  }

  if (p.state && !parts.some((part) => part.includes(p.state!))) {
    parts.push(p.state);
  }

  return parts.join(', ') || p.name || 'Unbekannt';
}

export function getZoomForType(type?: string): number {
  switch (type) {
    case 'house':
      return 17;
    case 'street':
      return 15;
    case 'district':
      return 13;
    case 'city':
      return 12;
    case 'state':
      return 8;
    case 'country':
      return 6;
    default:
      return 14;
  }
}
