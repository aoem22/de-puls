import type { BoundaryGeometry } from '@/lib/supabase/seo-queries';
import { CRIME_CATEGORIES, type CrimeCategory, type CrimeRecord } from '@/lib/types/crime';

interface CityBoundaryPreviewProps {
  cityName: string;
  boundaryGeometry: BoundaryGeometry | null;
  records: CrimeRecord[];
}

type Position = [number, number];
type PolygonRings = Position[][];

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 220;
const PADDING = 14;

const CATEGORY_COLORS = new Map<CrimeCategory, string>(
  CRIME_CATEGORIES.map((cat) => [cat.key, cat.color])
);

function getPolygons(geometry: BoundaryGeometry | null): PolygonRings[] {
  if (!geometry) return [];
  return geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates;
}

function flattenPositions(polygons: PolygonRings[]): Position[] {
  const out: Position[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const pos of ring) {
        out.push(pos);
      }
    }
  }
  return out;
}

function buildRingPath(
  ring: Position[],
  toScreen: (lon: number, lat: number) => [number, number],
): string {
  if (ring.length === 0) return '';

  const [startLon, startLat] = ring[0];
  const [startX, startY] = toScreen(startLon, startLat);
  let path = `M ${startX.toFixed(2)} ${startY.toFixed(2)}`;

  for (let i = 1; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    const [x, y] = toScreen(lon, lat);
    path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return `${path} Z`;
}

function buildPolygonPath(
  polygon: PolygonRings,
  toScreen: (lon: number, lat: number) => [number, number],
): string {
  return polygon
    .map((ring) => buildRingPath(ring, toScreen))
    .filter((segment) => segment.length > 0)
    .join(' ');
}

export function CityBoundaryPreview({ cityName, boundaryGeometry, records }: CityBoundaryPreviewProps) {
  const polygons = getPolygons(boundaryGeometry);
  const boundaryPoints = flattenPositions(polygons);
  const geocodedPoints = records
    .flatMap((record) => {
      if (typeof record.longitude !== 'number' || typeof record.latitude !== 'number') return [];
      return [{
        id: record.id,
        lon: record.longitude,
        lat: record.latitude,
        color: CATEGORY_COLORS.get(record.categories[0] ?? 'other') ?? '#0ea5e9',
      }];
    });

  const hasBoundary = boundaryPoints.length > 0;
  const allPoints = hasBoundary ? boundaryPoints : geocodedPoints.map((p) => [p.lon, p.lat] as Position);

  if (allPoints.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Kreisgrenze und Polizeipunkte
        </h3>
        <div className="rounded-lg border border-dashed border-[var(--card-border)] bg-[var(--card-inner)] p-6 text-center text-sm text-[var(--text-muted)]">
          Keine Geometriedaten verfuegbar.
        </div>
      </div>
    );
  }

  const minLon = Math.min(...allPoints.map((p) => p[0]));
  const maxLon = Math.max(...allPoints.map((p) => p[0]));
  const minLat = Math.min(...allPoints.map((p) => p[1]));
  const maxLat = Math.max(...allPoints.map((p) => p[1]));

  const lonSpan = Math.max(maxLon - minLon, 0.001);
  const latSpan = Math.max(maxLat - minLat, 0.001);

  const drawWidth = VIEWBOX_WIDTH - PADDING * 2;
  const drawHeight = VIEWBOX_HEIGHT - PADDING * 2;

  const toScreen = (lon: number, lat: number): [number, number] => {
    const x = PADDING + ((lon - minLon) / lonSpan) * drawWidth;
    const y = PADDING + (1 - (lat - minLat) / latSpan) * drawHeight;
    return [x, y];
  };

  const boundaryPaths = polygons
    .map((polygon) => buildPolygonPath(polygon, toScreen))
    .filter((d) => d.length > 0);

  const renderedPoints = geocodedPoints.map((point) => {
    const [x, y] = toScreen(point.lon, point.lat);
    return { ...point, x, y };
  });

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Kreisgrenze und Polizeipunkte
        </h3>
        <span className="text-xs text-[var(--text-muted)]">
          {renderedPoints.length} Meldungen
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="w-full h-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-inner)]"
        role="img"
        aria-label={`Kreisgrenze von ${cityName} mit Polizeimeldungen`}
      >
        <defs>
          <pattern id="city-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#city-grid)" />

        {boundaryPaths.map((path, index) => (
          <path
            key={`boundary-${index}`}
            d={path}
            fill="rgba(14,165,233,0.12)"
            stroke="rgba(14,165,233,0.78)"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            fillRule="evenodd"
          />
        ))}

        {renderedPoints.map((point) => (
          <g key={point.id}>
            <circle cx={point.x} cy={point.y} r="5.4" fill={point.color} opacity="0.20" />
            <circle cx={point.x} cy={point.y} r="2.4" fill={point.color} />
          </g>
        ))}
      </svg>

      <p className="mt-2 text-xs text-[var(--text-faint)]">
        Geocodierte Polizeimeldungen innerhalb von {cityName}.
      </p>
    </div>
  );
}
