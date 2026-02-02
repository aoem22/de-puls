'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON,
} from 'react-leaflet';
import type { Layer, LeafletMouseEvent, LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import 'leaflet/dist/leaflet.css';

import type { DistrictData, MetricKey } from '../../../lib/types/district';
import { METRICS } from '../../../lib/types/district';
import {
  createColorScale,
  calculateCorrelation,
} from '../../../lib/utils/colorScale';
import { Legend } from './Legend';
import { LayerControl } from './LayerControl';

// Import data
import districtsJson from '../../../lib/data/districts.json';
import geojsonData from '../../../lib/data/geojson-merged.json';

const districts = districtsJson as DistrictData[];
const geojson = geojsonData as FeatureCollection;

// Create a lookup map for district data by ID
const districtMap = new Map<string, DistrictData>();
districts.forEach((d) => districtMap.set(d.id, d));

// Darmstadt bounds and center
const DARMSTADT_CENTER: [number, number] = [49.8728, 8.6512];
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 11;
const MAX_ZOOM = 16;

// Bounding box for Darmstadt
const DARMSTADT_BOUNDS: LatLngBoundsExpression = [
  [49.78, 8.55],
  [49.95, 8.75],
];

// Calculate city-wide totals for percentage calculations
const cityTotals = {
  population: districts.reduce((sum, d) => sum + d.population, 0),
  migrationBackground: districts.reduce((sum, d) => sum + (d.migrationBackground || 0), 0),
  foreign: districts.reduce((sum, d) => sum + (d.foreign || 0), 0),
  households: districts.reduce((sum, d) => sum + (d.households || 0), 0),
  singleParentHouseholds: districts.reduce((sum, d) => sum + (d.singleParentHouseholds || 0), 0),
};

// Calculate percentage for a metric value
function getPercentage(district: DistrictData, metricKey: MetricKey): string | null {
  if (metricKey === 'population') {
    return ((district.population / cityTotals.population) * 100).toFixed(1) + '%';
  }
  if (metricKey === 'migrationBackground' && district.migrationBackground) {
    return ((district.migrationBackground / district.population) * 100).toFixed(1) + '%';
  }
  if (metricKey === 'singleParentHouseholds' && district.singleParentHouseholds && district.householdsWithChildren) {
    return ((district.singleParentHouseholds / district.householdsWithChildren) * 100).toFixed(1) + '%';
  }
  return null;
}

// Generate tooltip HTML content
function getTooltipHTML(
  district: DistrictData,
  selectedMetric: MetricKey,
  compareMetric: MetricKey | null,
  correlation: number | null
): string {
  const metric = METRICS[selectedMetric];
  const value = district[selectedMetric as keyof DistrictData] as number | null;
  const percentage = getPercentage(district, selectedMetric);

  const compareValue = compareMetric
    ? (district[compareMetric as keyof DistrictData] as number | null)
    : null;
  const comparePercentage = compareMetric ? getPercentage(district, compareMetric) : null;

  let html = `
    <div style="padding: 12px; min-width: 180px;">
      <div style="font-weight: 700; color: #fff; font-size: 14px; line-height: 1.3; border-bottom: 1px solid #444; padding-bottom: 8px; margin-bottom: 8px;">
        ${district.name}
      </div>
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 2px;">${metric.labelDe}</div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span style="font-size: 18px; font-weight: 700; color: #fff;">${metric.format(value)}</span>
          ${percentage ? `<span style="font-size: 11px; color: #22d3ee;">(${percentage})</span>` : ''}
        </div>
      </div>
  `;

  if (compareMetric && compareValue !== null) {
    const cMetric = METRICS[compareMetric];
    html += `
      <div style="margin-bottom: 8px; padding-top: 8px; border-top: 1px solid #444;">
        <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 2px;">${cMetric.labelDe}</div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <span style="font-size: 18px; font-weight: 700; color: #fff;">${cMetric.format(compareValue)}</span>
          ${comparePercentage ? `<span style="font-size: 11px; color: #f472b6;">(${comparePercentage})</span>` : ''}
        </div>
      </div>
    `;
  }

  html += `
      <div style="font-size: 11px; color: #71717a; padding-top: 8px; border-top: 1px solid #444;">
        ${district.population.toLocaleString('de-DE')} Einwohner
        <span style="color: #52525b;"> · ${((district.population / cityTotals.population) * 100).toFixed(1)}% der Stadt</span>
      </div>
    </div>
  `;

  return html;
}

export function ChoroplethMap() {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('migrationBackground');
  const [compareMetric, setCompareMetric] = useState<MetricKey | null>(null);
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
  const [isControlsExpanded, setIsControlsExpanded] = useState(false);

  // Store layer references for tooltip updates
  const layersRef = useRef<Map<string, L.Layer>>(new Map());

  const metric = METRICS[selectedMetric];
  const compareMetricConfig = compareMetric ? METRICS[compareMetric] : null;

  // Calculate correlation when comparing
  const correlation = useMemo(() => {
    if (!compareMetric) return null;
    return calculateCorrelation(metric, METRICS[compareMetric], districts);
  }, [selectedMetric, compareMetric]);

  // Create appropriate color scale
  const colorScale = useMemo(
    () => createColorScale(metric, districts),
    [selectedMetric]
  );


  // Update tooltips when metrics change
  useEffect(() => {
    layersRef.current.forEach((layer, districtId) => {
      const district = districtMap.get(districtId);
      if (district && (layer as L.Path).getTooltip) {
        const tooltip = (layer as L.Path).getTooltip();
        if (tooltip) {
          tooltip.setContent(getTooltipHTML(district, selectedMetric, compareMetric, correlation));
        }
      }
    });
  }, [selectedMetric, compareMetric, correlation]);

  // Style function for GeoJSON features
  const getStyle = useCallback(
    (feature?: Feature<Geometry, { districtId: string }>) => {
      if (!feature?.properties?.districtId) {
        return {
          fillColor: '#333333',
          weight: 1,
          opacity: 0.8,
          color: '#1a1a1a',
          fillOpacity: 0.5,
        };
      }

      const districtId = feature.properties.districtId;
      const district = districtMap.get(districtId);
      const isHovered = hoveredDistrict === districtId;

      // Always use primary metric for coloring
      const value = district
        ? (district[selectedMetric as keyof DistrictData] as number | null)
        : null;
      const fillColor = colorScale(value);

      return {
        fillColor,
        weight: isHovered ? 2 : 1,
        opacity: 1,
        color: isHovered ? '#ffffff' : 'rgba(255,255,255,0.15)',
        fillOpacity: isHovered ? 0.9 : 0.7,
      };
    },
    [selectedMetric, colorScale, hoveredDistrict]
  );

  // Event handlers for each feature
  const onEachFeature = useCallback(
    (
      feature: Feature<Geometry, { districtId: string; stat_Bez_1?: string }>,
      layer: Layer
    ) => {
      const districtId = feature.properties?.districtId;
      if (!districtId) return;

      const district = districtMap.get(districtId);
      if (!district) return;

      // Store layer reference
      layersRef.current.set(districtId, layer);

      // Bind tooltip to layer
      (layer as L.Path).bindTooltip(
        getTooltipHTML(district, selectedMetric, compareMetric, correlation),
        {
          sticky: true,
          direction: 'top',
          offset: [0, -10],
          opacity: 1,
          className: 'custom-tooltip',
        }
      );

      // Mouse events
      layer.on({
        mouseover: (e: LeafletMouseEvent) => {
          setHoveredDistrict(districtId);
          e.target.bringToFront();
        },
        mouseout: () => {
          setHoveredDistrict(null);
        },
      });
    },
    [selectedMetric, compareMetric, correlation]
  );

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={DARMSTADT_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={DARMSTADT_BOUNDS}
        maxBoundsViscosity={1.0}
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <GeoJSON
          key={`${selectedMetric}-${compareMetric}`}
          data={geojson}
          style={getStyle}
          onEachFeature={onEachFeature}
        />
      </MapContainer>

      {/* Mobile toggle button */}
      <button
        onClick={() => setIsControlsExpanded(!isControlsExpanded)}
        className="md:hidden absolute top-3 right-3 z-[1001] bg-[#141414]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#262626] p-3 text-zinc-200"
        aria-label="Toggle controls"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <line x1="2" x2="6" y1="14" y2="14" />
          <line x1="10" x2="14" y1="8" y2="8" />
          <line x1="18" x2="22" y1="16" y2="16" />
        </svg>
      </button>

      {/* Controls overlay */}
      <div
        className={`
          absolute z-[1000] transition-all duration-300 ease-in-out
          md:top-4 md:right-4 md:flex md:flex-col md:gap-3 md:max-w-[220px] md:opacity-100 md:translate-x-0
          ${isControlsExpanded
            ? 'top-16 right-3 left-3 opacity-100 translate-y-0'
            : 'top-16 right-3 left-3 opacity-0 -translate-y-4 pointer-events-none md:pointer-events-auto md:opacity-100 md:translate-y-0'
          }
        `}
      >
        <LayerControl
          selectedMetric={selectedMetric}
          compareMetric={compareMetric}
          correlation={correlation}
          onMetricChange={(metric) => {
            setSelectedMetric(metric);
            setIsControlsExpanded(false);
          }}
          onCompareMetricChange={setCompareMetric}
        />
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-2 right-2 md:left-4 md:right-auto z-[1000]">
        <Legend
          metric={metric}
          compareMetric={null}
          data={districts}
        />
      </div>
    </div>
  );
}
