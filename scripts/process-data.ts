import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import proj4 from 'proj4';
import * as turf from '@turf/turf';

// Define EPSG:25832 (UTM zone 32N) and WGS84
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const EPSG25832 = 'EPSG:25832';
const WGS84 = 'EPSG:4326';

interface DistrictData {
  id: string;
  name: string;
  population: number;
  armutsindex: number | null;
  kinderarmut: number | null;
  kinderarmutAbsolute: number | null;
  erwachsenenarmut: number | null;
  erwachsenenarmutAbsolute: number | null;
  altersarmut: number | null;
  altersarmutAbsolute: number | null;
}

// Process Excel data
function processExcel(filePath: string): Map<string, DistrictData> {
  const workbook = XLSX.readFile(filePath);
  const districts = new Map<string, DistrictData>();

  // Parse "Einwohnerinnen und Einwohner" sheet for population
  const populationSheet = workbook.Sheets['Einwohnerinnen und Einwohner '];
  const populationData = XLSX.utils.sheet_to_json(populationSheet, { header: 1 }) as any[][];

  for (let i = 3; i < populationData.length; i++) {
    const row = populationData[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const name = String(row[1] || '').trim();
    const population = typeof row[2] === 'number' ? row[2] : 0;

    if (id && name) {
      districts.set(id, {
        id,
        name,
        population,
        armutsindex: null,
        kinderarmut: null,
        kinderarmutAbsolute: null,
        erwachsenenarmut: null,
        erwachsenenarmutAbsolute: null,
        altersarmut: null,
        altersarmutAbsolute: null,
      });
    }
  }

  // Parse "Armutsindex" sheet
  const armutsindexSheet = workbook.Sheets['Armutsindex'];
  const armutsindexData = XLSX.utils.sheet_to_json(armutsindexSheet, { header: 1 }) as any[][];

  for (let i = 3; i < armutsindexData.length; i++) {
    const row = armutsindexData[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const value = typeof row[2] === 'number' ? row[2] : null;

    if (districts.has(id)) {
      districts.get(id)!.armutsindex = value;
    }
  }

  // Parse "I Kinderarmut" sheet
  const kinderarmutSheet = workbook.Sheets['I Kinderarmut '];
  const kinderarmutData = XLSX.utils.sheet_to_json(kinderarmutSheet, { header: 1 }) as any[][];

  for (let i = 3; i < kinderarmutData.length; i++) {
    const row = kinderarmutData[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const indicator = typeof row[2] === 'number' ? row[2] : null;
    const absolute = typeof row[3] === 'number' ? row[3] : null;

    if (districts.has(id)) {
      districts.get(id)!.kinderarmut = indicator;
      districts.get(id)!.kinderarmutAbsolute = absolute;
    }
  }

  // Parse "II Erwachsenenarmut" sheet
  const erwachsenenarmutSheet = workbook.Sheets['II Erwachsenenarmut'];
  const erwachsenenarmutData = XLSX.utils.sheet_to_json(erwachsenenarmutSheet, { header: 1 }) as any[][];

  for (let i = 3; i < erwachsenenarmutData.length; i++) {
    const row = erwachsenenarmutData[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const indicator = typeof row[2] === 'number' ? row[2] : null;
    const absolute = typeof row[3] === 'number' ? row[3] : null;

    if (districts.has(id)) {
      districts.get(id)!.erwachsenenarmut = indicator;
      districts.get(id)!.erwachsenenarmutAbsolute = absolute;
    }
  }

  // Parse "III Altersarmut" sheet
  const altersarmutSheet = workbook.Sheets['III Altersarmut'];
  const altersarmutData = XLSX.utils.sheet_to_json(altersarmutSheet, { header: 1 }) as any[][];

  for (let i = 3; i < altersarmutData.length; i++) {
    const row = altersarmutData[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const indicator = typeof row[2] === 'number' ? row[2] : null;
    const absolute = typeof row[3] === 'number' ? row[3] : null;

    if (districts.has(id)) {
      districts.get(id)!.altersarmut = indicator;
      districts.get(id)!.altersarmutAbsolute = absolute;
    }
  }

  return districts;
}

// Transform coordinates from EPSG:25832 to WGS84
function transformCoordinates(coords: any): any {
  if (typeof coords[0] === 'number') {
    // Single coordinate pair
    const [lng, lat] = proj4(EPSG25832, WGS84, coords);
    return [lng, lat];
  }
  // Nested array
  return coords.map(transformCoordinates);
}

// Process GeoJSON
async function processGeoJSON(): Promise<any> {
  const response = await fetch('https://opendata.darmstadt.de/sites/default/files/DA_ST_Bezirke.geojson');
  const geojson = await response.json();

  // Find features for 110 and 130
  let feature110: any = null;
  let feature130: any = null;
  const otherFeatures: any[] = [];

  for (const feature of geojson.features) {
    const statBez = feature.properties.StatBez;

    // Transform coordinates to WGS84
    feature.geometry.coordinates = transformCoordinates(feature.geometry.coordinates);

    if (statBez === 110) {
      feature110 = feature;
    } else if (statBez === 130) {
      feature130 = feature;
    } else {
      // Convert StatBez to string id format matching Excel
      feature.properties.districtId = String(statBez);
      otherFeatures.push(feature);
    }
  }

  // Merge 110 and 130 polygons
  if (feature110 && feature130) {
    try {
      // Use turf.union to merge the two polygons
      const merged = turf.union(
        turf.featureCollection([feature110, feature130])
      );
      if (merged) {
        merged.properties = {
          StatBez: '110&130',
          stat_Bez_1: 'Stadtzentrum & Hochschulviertel',
          districtId: '110&130',
        };
        otherFeatures.push(merged);
      }
    } catch (e) {
      console.error('Error merging polygons:', e);
      // Fallback: create a MultiPolygon from both
      const multiPolygon = turf.multiPolygon([
        feature110.geometry.coordinates,
        feature130.geometry.coordinates,
      ], {
        StatBez: '110&130',
        stat_Bez_1: 'Stadtzentrum & Hochschulviertel',
        districtId: '110&130',
      });
      otherFeatures.push(multiPolygon);
    }
  }

  return {
    type: 'FeatureCollection',
    features: otherFeatures,
  };
}

async function main() {
  console.log('Processing Excel data...');
  const excelPath = '/Users/alanozalp/Downloads/Daten_Sozialatlas_2025_0.xlsx';
  const districts = processExcel(excelPath);

  console.log(`Found ${districts.size} districts in Excel`);

  // Convert to array and save
  const districtsArray = Array.from(districts.values());
  const districtsJson = JSON.stringify(districtsArray, null, 2);

  const dataDir = path.join(process.cwd(), 'lib', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(path.join(dataDir, 'districts.json'), districtsJson);
  console.log('Saved districts.json');

  console.log('\nProcessing GeoJSON...');
  const geojson = await processGeoJSON();

  console.log(`Processed ${geojson.features.length} features in GeoJSON`);

  fs.writeFileSync(path.join(dataDir, 'geojson-merged.json'), JSON.stringify(geojson, null, 2));
  console.log('Saved geojson-merged.json');

  // Verify matching
  console.log('\n=== Verification ===');
  const geojsonIds = new Set(geojson.features.map((f: any) => f.properties.districtId));
  const excelIds = new Set(districts.keys());

  console.log('GeoJSON district IDs:', Array.from(geojsonIds).sort());
  console.log('\nExcel district IDs:', Array.from(excelIds).sort());

  const missingInGeoJSON = Array.from(excelIds).filter(id => !geojsonIds.has(id));
  const missingInExcel = Array.from(geojsonIds).filter(id => !excelIds.has(id));

  if (missingInGeoJSON.length > 0) {
    console.log('\nDistricts in Excel but not in GeoJSON:', missingInGeoJSON);
  }
  if (missingInExcel.length > 0) {
    console.log('\nDistricts in GeoJSON but not in Excel:', missingInExcel);
  }
  if (missingInGeoJSON.length === 0 && missingInExcel.length === 0) {
    console.log('\n✓ All districts match!');
  }

  // Print some stats
  console.log('\n=== Sample Data ===');
  const highPoverty = districtsArray
    .filter(d => d.armutsindex !== null)
    .sort((a, b) => (b.armutsindex || 0) - (a.armutsindex || 0))
    .slice(0, 5);

  console.log('\nTop 5 highest Armutsindex:');
  highPoverty.forEach(d => {
    console.log(`  ${d.name}: ${d.armutsindex?.toFixed(2)}`);
  });
}

main().catch(console.error);
