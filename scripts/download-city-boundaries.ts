/**
 * Download and process city boundaries from BKG VG250 via OpenDataSoft
 *
 * This script:
 * 1. Fetches German Gemeinde (municipality) boundaries
 * 2. Filters to only the 84 cities in our PKS crime data
 * 3. Simplifies geometries to reduce file size
 * 4. Outputs a GeoJSON file for use in the map
 */

import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';

const DATA_DIR = path.join(process.cwd(), 'lib', 'data');
const CRIME_DATA_FILE = path.join(DATA_DIR, 'city-crimes.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'cities-geojson.json');

// OpenDataSoft API for German administrative boundaries
// This dataset contains Gemeinde (municipality) polygons with 12-digit AGS codes
const OPENDATASOFT_API = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-germany-gemeinde/exports/geojson';

async function fetchCityBoundaries(): Promise<any> {
  console.log('Fetching German municipality boundaries from OpenDataSoft...');

  // Load our city list from crime data
  const crimeData = JSON.parse(fs.readFileSync(CRIME_DATA_FILE, 'utf-8'));
  const cityKeys = new Set(Object.keys(crimeData.cities));
  console.log(`Looking for ${cityKeys.size} cities\n`);

  // Create a map of 8-digit AGS to city data
  const cityMap = new Map<string, { name: string; ags: string }>();
  for (const ags of cityKeys) {
    cityMap.set(ags, { name: crimeData.cities[ags].name, ags });
  }

  // Fetch the GeoJSON
  const response = await fetch(OPENDATASOFT_API, {
    headers: {
      Accept: 'application/geo+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const geojson = await response.json();
  console.log(`Fetched ${geojson.features.length} total municipalities\n`);

  // Filter to only our cities
  // OpenDataSoft uses 12-digit AGS codes in arrays, we need to match first 8 digits
  const matchedFeatures: any[] = [];
  const unmatchedCities = new Set(cityKeys);

  for (const feature of geojson.features) {
    // Properties are arrays in this API
    const gemCodeArr = feature.properties?.gem_code;
    const gemNameArr = feature.properties?.gem_name;
    const lanNameArr = feature.properties?.lan_name;

    if (!gemCodeArr || !Array.isArray(gemCodeArr)) continue;

    const gemCode12 = gemCodeArr[0]; // 12-digit code
    if (!gemCode12) continue;

    // Extract first 8 digits to match our 8-digit AGS
    const ags8 = gemCode12.substring(0, 8);

    if (cityKeys.has(ags8)) {
      unmatchedCities.delete(ags8);
      const gemName = Array.isArray(gemNameArr) ? gemNameArr[0] : gemNameArr;
      const lanName = Array.isArray(lanNameArr) ? lanNameArr[0] : lanNameArr;

      matchedFeatures.push({
        type: 'Feature',
        properties: {
          ags: ags8,
          name: crimeData.cities[ags8]?.name || gemName,
          state: lanName,
        },
        geometry: feature.geometry,
      });
    }
  }

  console.log(`Matched ${matchedFeatures.length} cities by AGS prefix`);

  // For unmatched cities, try fuzzy name matching
  if (unmatchedCities.size > 0) {
    console.log(`\nTrying to match ${unmatchedCities.size} remaining cities by name...`);

    for (const feature of geojson.features) {
      const gemNameArr = feature.properties?.gem_name;
      const gemCodeArr = feature.properties?.gem_code;
      const lanNameArr = feature.properties?.lan_name;

      if (!gemNameArr || !gemCodeArr) continue;

      const gemName = (Array.isArray(gemNameArr) ? gemNameArr[0] : gemNameArr) || '';
      const gemNameLower = gemName.toLowerCase().replace(/[^a-zäöüß]/g, '');

      for (const ags of unmatchedCities) {
        const cityName = crimeData.cities[ags]?.name || '';
        const cityNameLower = cityName.toLowerCase().replace(/[^a-zäöüß]/g, '');

        // Check if names match (allowing for prefixes like "Stadt", "Gemeinde")
        const nameMatch = gemNameLower.includes(cityNameLower) ||
          cityNameLower.includes(gemNameLower) ||
          gemNameLower === cityNameLower;

        if (nameMatch && cityNameLower.length > 3) {
          console.log(`  Matched ${cityName} -> ${gemName} (${gemCodeArr[0]})`);
          unmatchedCities.delete(ags);

          const lanName = Array.isArray(lanNameArr) ? lanNameArr[0] : lanNameArr;
          matchedFeatures.push({
            type: 'Feature',
            properties: {
              ags: ags,
              name: cityName,
              state: lanName,
              originalAgs: gemCodeArr[0],
            },
            geometry: feature.geometry,
          });
          break;
        }
      }
    }
  }

  // Deduplicate - keep only one feature per AGS
  const uniqueByAgs = new Map<string, any>();
  for (const feature of matchedFeatures) {
    const ags = feature.properties.ags;
    if (!uniqueByAgs.has(ags)) {
      uniqueByAgs.set(ags, feature);
    }
  }

  const dedupedFeatures = Array.from(uniqueByAgs.values());
  console.log(`\nFinal matched: ${dedupedFeatures.length} cities (${matchedFeatures.length - dedupedFeatures.length} duplicates removed)`);

  if (unmatchedCities.size > 0) {
    console.log('\nStill unmatched:');
    for (const ags of unmatchedCities) {
      const city = crimeData.cities[ags];
      console.log(`  ${ags}: ${city?.name}`);
    }
  }

  return {
    type: 'FeatureCollection',
    features: dedupedFeatures,
  };
}

function simplifyGeometry(geojson: any): any {
  console.log('\nSimplifying geometries...');

  const simplified = {
    type: 'FeatureCollection',
    features: geojson.features.map((feature: any) => {
      try {
        // Simplify with tolerance of 0.001 degrees (~100m at German latitudes)
        const simpleFeature = turf.simplify(feature, {
          tolerance: 0.001,
          highQuality: true,
        });
        return simpleFeature;
      } catch (e) {
        console.warn(`Failed to simplify ${feature.properties.name}:`, e);
        return feature;
      }
    }),
  };

  // Calculate size reduction
  const originalSize = JSON.stringify(geojson).length;
  const simplifiedSize = JSON.stringify(simplified).length;
  const reduction = ((originalSize - simplifiedSize) / originalSize) * 100;
  console.log(`Size reduced from ${(originalSize / 1024).toFixed(0)}KB to ${(simplifiedSize / 1024).toFixed(0)}KB (${reduction.toFixed(1)}% reduction)`);

  return simplified;
}

async function main() {
  console.log('=== City Boundaries Download Script ===\n');

  // Check if crime data exists
  if (!fs.existsSync(CRIME_DATA_FILE)) {
    console.error('Error: city-crimes.json not found. Run process-city-crimes.ts first.');
    process.exit(1);
  }

  // Fetch boundaries
  const geojson = await fetchCityBoundaries();

  // Simplify geometries
  const simplified = simplifyGeometry(geojson);

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(simplified, null, 2));
  console.log(`\nWrote ${OUTPUT_FILE}`);

  // Stats
  console.log(`\nTotal features: ${simplified.features.length}`);

  // Calculate bounding box for Germany
  const bbox = turf.bbox(simplified);
  console.log(`Bounding box: [${bbox.map((b) => b.toFixed(2)).join(', ')}]`);

  console.log('\nDone!');
}

main().catch(console.error);
