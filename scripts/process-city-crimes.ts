/**
 * Process PKS Excel files into structured JSON for city crime statistics
 * Handles multiple years of data
 *
 * Output: lib/data/city-crimes.json
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import type { CityData, CrimeStats, CrimeTypeKey } from '../lib/types/cityCrime';
import { CRIME_TYPE_MAPPING, CITY_CRIME_TYPES } from '../lib/types/cityCrime';

// Map of year to file path
const FILES_BY_YEAR: Record<string, string> = {
  '2024': '/Users/alanozalp/Downloads/ST-F-01-T01-Staedte-Faelle-HZ_xls.xlsx',
  '2023': '/Users/alanozalp/Downloads/ST-F-01-T01-Staedte-Faelle-HZ_xls (1).xlsx',
  '2021': '/Users/alanozalp/Downloads/ST-F-01-T01-Staedte-Faelle-HZ_xls (2).xlsx',
  '2020': '/Users/alanozalp/Downloads/ST-F-01-T01-Staedte-Faelle-HZ_xls (3).xlsx',
  '2019': '/Users/alanozalp/Downloads/ST-F-01-T01-Staedte-Faelle-HZ_xls (4).xlsx',
};

const OUTPUT_DIR = path.join(process.cwd(), 'lib', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'city-crimes.json');

interface RawRow {
  schluessel: string;
  straftat: string;
  gemeindeschluessel: string;
  stadt: string;
  cases: number;
  hz: number;
  aq: number;
}

type ExcelCell = string | number | boolean | Date | null | undefined;

function parseExcel(filePath: string): RawRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<ExcelCell[]>(sheet, { header: 1 });

  const rows: RawRow[] = [];

  // Data starts at row 9 (index 9)
  for (let i = 9; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1] || !row[2] || !row[3]) continue;

    const straftat = String(row[1]).trim();
    const gemeindeschluessel = String(row[2]).trim();
    const stadt = String(row[3]).trim();
    const cases = typeof row[4] === 'number' ? row[4] : 0;
    const hz = typeof row[5] === 'number' ? row[5] : 0;
    // AQ is in column 11 (index 11)
    const aq = typeof row[11] === 'number' ? row[11] : 0;

    rows.push({
      schluessel: String(row[0] || '').trim(),
      straftat,
      gemeindeschluessel,
      stadt,
      cases,
      hz,
      aq,
    });
  }

  return rows;
}

function processCrimeData(rows: RawRow[]): Map<string, CityData> {
  const cities = new Map<string, CityData>();

  for (const row of rows) {
    // Get or create city
    let city = cities.get(row.gemeindeschluessel);
    if (!city) {
      city = {
        name: row.stadt,
        gemeindeschluessel: row.gemeindeschluessel,
        crimes: {} as Record<CrimeTypeKey, CrimeStats>,
      };
      cities.set(row.gemeindeschluessel, city);
    }

    // Map the crime type
    const crimeTypeKey = CRIME_TYPE_MAPPING[row.straftat];
    if (!crimeTypeKey) {
      continue;
    }

    // Store the crime stats
    city.crimes[crimeTypeKey] = {
      cases: row.cases,
      hz: Math.round(row.hz * 10) / 10,
      aq: row.aq,
    };
  }

  return cities;
}

function main() {
  console.log('Processing PKS city crime statistics for multiple years...\n');

  const years = Object.keys(FILES_BY_YEAR).sort();
  const dataByYear: Record<string, Record<string, CityData>> = {};

  for (const year of years) {
    const filePath = FILES_BY_YEAR[year];
    console.log(`Processing ${year}: ${filePath.split('/').pop()}...`);

    try {
      const rows = parseExcel(filePath);
      const cities = processCrimeData(rows);
      dataByYear[year] = Object.fromEntries(cities);
      console.log(`  -> ${cities.size} cities, ${rows.length} rows`);
    } catch (e) {
      console.error(`  Error processing ${year}: ${e}`);
    }
  }

  // Convert to output format
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'PKS (Polizeiliche Kriminalstatistik)',
    years: years,
    dataByYear,
    crimeTypes: CITY_CRIME_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      labelDe: t.labelDe,
      category: t.category,
    })),
  };

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_FILE}`);

  // Print some statistics
  console.log('\n=== Statistics ===');
  console.log(`Years: ${years.join(', ')}`);

  // Compare total crime rates across years for a sample city (Berlin)
  console.log('\nBerlin total crime rate (HZ) by year:');
  for (const year of years) {
    const berlin = dataByYear[year]?.['11000000'];
    if (berlin?.crimes.total) {
      console.log(`  ${year}: ${berlin.crimes.total.hz.toLocaleString('de-DE')} per 100k`);
    }
  }

  console.log('\nDone!');
}

main();
