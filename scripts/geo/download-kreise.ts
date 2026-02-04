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
import { GEO_LEVELS } from '../../lib/geo/types';

const config = GEO_LEVELS.kreis;
const API_URL = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/${config.dataset}/exports/geojson`;
const OUTPUT_DIR = path.join(__dirname, '../../lib/data/geo');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'kreise.json');
const TEMP_DIR = path.join(__dirname, '../../.tmp');
const TEMP_RAW = path.join(TEMP_DIR, 'kreise-raw.json');
const TEMP_PROCESSED = path.join(TEMP_DIR, 'kreise-processed.json');

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

  const geojson = await response.json();
  console.log(`Downloaded ${geojson.features.length} features\n`);

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
  const processed = JSON.parse(fs.readFileSync(TEMP_PROCESSED, 'utf-8'));

  // Sort by AGS for consistent output
  processed.features.sort((a: any, b: any) =>
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
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      vertexCount += geom.coordinates.reduce((s: number, r: any[]) => s + r.length, 0);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        vertexCount += poly.reduce((s: number, r: any[]) => s + r.length, 0);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Features: ${processed.features.length}`);
  console.log(`Vertices: ${vertexCount.toLocaleString()}`);
  console.log(`File size: ${sizeKB} KB`);
  console.log(`Output: ${OUTPUT_PATH}`);

  console.log('\n=== Sample Features ===');
  processed.features.slice(0, 5).forEach((f: any) => {
    console.log(`  ${f.properties.ags}: ${f.properties.name} (${f.properties.bundesland})`);
  });

  console.log('\n✓ Done!');
}

downloadAndProcess().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
