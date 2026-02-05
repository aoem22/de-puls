/**
 * Download and process Kreis boundaries using mapshaper for topology-aware processing
 *
 * Mapshaper automatically handles shared borders - when you simplify,
 * adjacent polygons keep their shared edges perfectly aligned.
 *
 * Usage: npx tsx scripts/geo/download-kreise.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { FeatureCollection, Geometry } from 'geojson';
import { GEO_LEVELS } from '../../lib/geo/types';

const config = GEO_LEVELS.kreis;
const API_URL = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/${config.dataset}/exports/geojson`;
const OUTPUT_DIR = path.join(__dirname, '../../lib/data/geo');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'kreise.json');
const TEMP_DIR = path.join(__dirname, '../../.tmp');
const TEMP_RAW = path.join(TEMP_DIR, 'kreise-raw.json');
const TEMP_PROCESSED = path.join(TEMP_DIR, 'kreise-processed.json');

interface KreisProperties {
  ags: string;
  name: string;
  bundesland: string;
}

type KreisCollection = FeatureCollection<Geometry, KreisProperties>;

function countVertices(geometry: Geometry): number {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce(
      (sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0
    );
  }
  return 0;
}

async function downloadAndProcess(): Promise<void> {
  console.log(`Fetching ${config.dataset} from OpenDataSoft...`);
  console.log(`URL: ${API_URL}\n`);

  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Download raw GeoJSON
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const geojson = await response.json() as { features?: unknown[] };
  const downloadedCount = Array.isArray(geojson.features) ? geojson.features.length : 0;
  console.log(`Downloaded ${downloadedCount} features\n`);

  // Save raw data
  fs.writeFileSync(TEMP_RAW, JSON.stringify(geojson));

  // Use mapshaper for topology-aware processing
  // -snap: snaps nearby vertices together (fixes gaps between adjacent polygons)
  // -clean: removes remaining small gaps and overlaps
  // -simplify: topology-aware (shared borders stay aligned)
  console.log('Processing with mapshaper (topology-aware)...\n');

  // Target ~20-25k vertices for good detail without huge file
  // 0.0001 degrees ≈ 11 meters snap tolerance
  const mapshaperCmd = `mapshaper ${TEMP_RAW} \
    -snap interval=0.0001 \
    -clean \
    -simplify dp 5% keep-shapes \
    -filter-fields krs_code,krs_name,lan_code \
    -each 'ags = krs_code[0], name = krs_name[0], bundesland = lan_code[0]' \
    -filter-fields ags,name,bundesland \
    -o ${TEMP_PROCESSED} format=geojson precision=0.00001`;

  try {
    execSync(mapshaperCmd, { stdio: 'inherit' });
  } catch (error) {
    console.error('Mapshaper processing failed:', error);
    throw error;
  }

  // Read processed data
  const processed = JSON.parse(fs.readFileSync(TEMP_PROCESSED, 'utf-8')) as KreisCollection;

  // Sort by AGS for consistent output
  processed.features.sort((a, b) =>
    a.properties.ags.localeCompare(b.properties.ags)
  );

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write final output (minified)
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(processed));

  // Cleanup temp files
  fs.unlinkSync(TEMP_RAW);
  fs.unlinkSync(TEMP_PROCESSED);

  // Calculate stats
  const stats = fs.statSync(OUTPUT_PATH);
  const sizeKB = (stats.size / 1024).toFixed(1);

  // Count vertices in output
  let vertexCount = 0;
  for (const feature of processed.features) {
    vertexCount += countVertices(feature.geometry);
  }

  console.log('\n=== Summary ===');
  console.log(`Features: ${processed.features.length}`);
  console.log(`Vertices: ${vertexCount.toLocaleString()}`);
  console.log(`File size: ${sizeKB} KB`);
  console.log(`Output: ${OUTPUT_PATH}`);

  console.log('\n=== Sample Features ===');
  processed.features.slice(0, 5).forEach((f) => {
    console.log(`  ${f.properties.ags}: ${f.properties.name} (${f.properties.bundesland})`);
  });

  console.log('\n✓ Done!');
}

downloadAndProcess().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
