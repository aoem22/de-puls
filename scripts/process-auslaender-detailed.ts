/**
 * Process Ausländer (foreigners) statistics with region/nationality breakdown
 * Source: 12521-0041_de.xlsx
 *
 * Output: lib/data/indicators/auslaender.json (replaces simple version)
 *
 * Usage: npx tsx scripts/process-auslaender-detailed.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const INPUT_FILE = '/Users/alanozalp/Downloads/12521-0041_de.xlsx';
const OUTPUT_DIR = path.join(__dirname, '../lib/data/indicators');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'auslaender.json');

// Define the region keys we want to extract
const REGION_KEYS = [
  'total',
  'europa',
  'eu27',
  'drittstaaten',
  'afrika',
  'nordafrika',
  'westafrika',
  'zentralafrika',
  'ostafrika',
  'suedafrika',
  'amerika',
  'nordamerika',
  'mittelamerika',
  'suedamerika',
  'asien',
  'vorderasien',
  'suedostasien',
  'ostasien',
  'ozeanien',
  'gastarbeiter',
  'exjugoslawien',
  'exsowjetunion',
] as const;

type RegionKey = (typeof REGION_KEYS)[number];

// Map German labels to our keys
const LABEL_TO_KEY: Record<string, RegionKey> = {
  'Insgesamt': 'total',
  'Europa': 'europa',
  'EU-27 (seit 01.02.2020)': 'eu27',
  'Drittstaaten zu EU-27 (seit 01.02.2020)': 'drittstaaten',
  'Afrika': 'afrika',
  'Nordafrika': 'nordafrika',
  'Westafrika': 'westafrika',
  'Zentralafrika': 'zentralafrika',
  'Ostafrika': 'ostafrika',
  'Südafrika': 'suedafrika',
  'Amerika': 'amerika',
  'Nordamerika': 'nordamerika',
  'Mittelamerika und Karibik': 'mittelamerika',
  'Südamerika': 'suedamerika',
  'Asien': 'asien',
  'Vorderasien': 'vorderasien',
  'Süd- und Südostasien': 'suedostasien',
  'Ost- und Zentralasien': 'ostasien',
  'Australien und Ozeanien': 'ozeanien',
  'Gastarbeiterländer': 'gastarbeiter',
  'Gebiet des ehemaligen Jugoslawien': 'exjugoslawien',
  'Gebiet der ehemaligen Sowjetunion': 'exsowjetunion',
};

// Metadata for each region (for UI display)
export const REGION_META: Record<RegionKey, { labelDe: string; label: string; category: string }> = {
  total: { labelDe: 'Gesamt', label: 'Total', category: 'Gesamt' },
  europa: { labelDe: 'Europa', label: 'Europe', category: 'Kontinent' },
  eu27: { labelDe: 'EU-27', label: 'EU-27', category: 'Europa' },
  drittstaaten: { labelDe: 'Drittstaaten (Nicht-EU)', label: 'Non-EU', category: 'Europa' },
  afrika: { labelDe: 'Afrika', label: 'Africa', category: 'Kontinent' },
  nordafrika: { labelDe: 'Nordafrika', label: 'North Africa', category: 'Afrika' },
  westafrika: { labelDe: 'Westafrika', label: 'West Africa', category: 'Afrika' },
  zentralafrika: { labelDe: 'Zentralafrika', label: 'Central Africa', category: 'Afrika' },
  ostafrika: { labelDe: 'Ostafrika', label: 'East Africa', category: 'Afrika' },
  suedafrika: { labelDe: 'Südafrika', label: 'Southern Africa', category: 'Afrika' },
  amerika: { labelDe: 'Amerika', label: 'Americas', category: 'Kontinent' },
  nordamerika: { labelDe: 'Nordamerika', label: 'North America', category: 'Amerika' },
  mittelamerika: { labelDe: 'Mittelamerika & Karibik', label: 'Central America & Caribbean', category: 'Amerika' },
  suedamerika: { labelDe: 'Südamerika', label: 'South America', category: 'Amerika' },
  asien: { labelDe: 'Asien', label: 'Asia', category: 'Kontinent' },
  vorderasien: { labelDe: 'Vorderasien (Naher Osten)', label: 'Middle East', category: 'Asien' },
  suedostasien: { labelDe: 'Süd- & Südostasien', label: 'South & Southeast Asia', category: 'Asien' },
  ostasien: { labelDe: 'Ost- & Zentralasien', label: 'East & Central Asia', category: 'Asien' },
  ozeanien: { labelDe: 'Australien & Ozeanien', label: 'Australia & Oceania', category: 'Kontinent' },
  gastarbeiter: { labelDe: 'Gastarbeiterländer', label: 'Guest Worker Countries', category: 'Historisch' },
  exjugoslawien: { labelDe: 'Ex-Jugoslawien', label: 'Former Yugoslavia', category: 'Historisch' },
  exsowjetunion: { labelDe: 'Ex-Sowjetunion', label: 'Former Soviet Union', category: 'Historisch' },
};

interface RegionData {
  male: number | null;
  female: number | null;
  total: number | null;
}

interface AuslaenderRecord {
  ags: string;
  name: string;
  regions: Record<RegionKey, RegionData>;
}

interface AuslaenderData {
  meta: {
    source: string;
    description: string;
    geoLevel: 'kreis';
    unit: string;
    years: string[];
    regionMeta: typeof REGION_META;
  };
  data: Record<string, Record<string, AuslaenderRecord>>; // year -> ags -> record
}

function parseValue(val: unknown): number | null {
  if (val === '-' || val === '.' || val === '...' || val === null || val === undefined) {
    return null;
  }
  if (typeof val === 'number') return val;
  const num = parseFloat(String(val).replace(/\s/g, ''));
  return isNaN(num) ? null : num;
}

function normalizeAgs(ags: string): string {
  return ags.padStart(5, '0');
}

function createEmptyRegions(): Record<RegionKey, RegionData> {
  const regions = {} as Record<RegionKey, RegionData>;
  for (const key of REGION_KEYS) {
    regions[key] = { male: null, female: null, total: null };
  }
  return regions;
}

async function processAuslaenderDetailed(): Promise<void> {
  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(INPUT_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  console.log(`Total rows: ${rows.length}`);

  const result: AuslaenderData = {
    meta: {
      source: 'DESTATIS 12521-0041',
      description: 'Ausländer nach Kreisen, Geschlecht, Herkunftsregion',
      geoLevel: 'kreis',
      unit: 'Anzahl',
      years: [],
      regionMeta: REGION_META,
    },
    data: {},
  };

  let currentYear: string | null = null;
  let currentAgs: string | null = null;
  let currentName: string | null = null;
  let currentRecord: AuslaenderRecord | null = null;
  let processedKreise = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const col0 = row[0] !== null && row[0] !== undefined ? String(row[0]).trim() : '';
    const col1 = row[1] !== null && row[1] !== undefined ? String(row[1]).trim() : '';
    const col2 = row[2] !== null && row[2] !== undefined ? String(row[2]).trim() : '';

    // Check if this is a year header row (e.g., "31.12.1998")
    if (col0.match(/^31\.12\.\d{4}$/)) {
      currentYear = col0.replace('31.12.', '');
      result.data[currentYear] = {};
      result.meta.years.push(currentYear);
      console.log(`  Found year: ${currentYear}`);
      currentAgs = null;
      currentRecord = null;
      continue;
    }

    if (!currentYear) continue;

    // Check if first cell is an AGS code (5-digit number)
    if (/^\d{4,5}$/.test(col0)) {
      // Save previous record if exists
      if (currentRecord && currentAgs) {
        result.data[currentYear][currentAgs] = currentRecord;
        processedKreise++;
      }

      currentAgs = normalizeAgs(col0);
      currentName = col1;
      currentRecord = {
        ags: currentAgs,
        name: currentName,
        regions: createEmptyRegions(),
      };

      // The "Insgesamt" row is on the same line as AGS
      if (col2 === 'Insgesamt') {
        currentRecord.regions.total = {
          male: parseValue(row[3]),
          female: parseValue(row[5]),
          total: parseValue(row[7]),
        };
      }
      continue;
    }

    // Check if this is a region data row (col2 has the region label)
    if (currentRecord && col2 && col2 !== 'und zwar:') {
      const regionKey = LABEL_TO_KEY[col2];
      if (regionKey) {
        currentRecord.regions[regionKey] = {
          male: parseValue(row[3]),
          female: parseValue(row[5]),
          total: parseValue(row[7]),
        };
      }
    }
  }

  // Save last record
  if (currentRecord && currentAgs && currentYear) {
    result.data[currentYear][currentAgs] = currentRecord;
    processedKreise++;
  }

  // Keep only recent years (last 10 years)
  const recentYears = result.meta.years.slice(-10);
  result.meta.years = recentYears;

  const filteredData: Record<string, Record<string, AuslaenderRecord>> = {};
  for (const year of recentYears) {
    filteredData[year] = result.data[year];
  }
  result.data = filteredData;

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write output (no pretty printing for smaller size)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result));

  const stats = fs.statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log('\n=== Summary ===');
  console.log(`Years included: ${recentYears.join(', ')}`);
  console.log(`Kreise processed: ${processedKreise}`);
  console.log(`Regions tracked: ${REGION_KEYS.length}`);
  console.log(`File size: ${sizeKB} KB (${sizeMB} MB)`);
  console.log(`Output: ${OUTPUT_FILE}`);

  // Sample data
  const latestYear = recentYears[recentYears.length - 1];
  const latestData = result.data[latestYear];
  const sampleAgs = Object.keys(latestData).slice(0, 3);
  console.log(`\n=== Sample Data (${latestYear}) ===`);
  sampleAgs.forEach((ags) => {
    const record = latestData[ags];
    console.log(`\n  ${ags}: ${record.name}`);
    console.log(`    Gesamt: ${record.regions.total.total?.toLocaleString('de-DE') ?? 'N/A'}`);
    console.log(`    Europa: ${record.regions.europa.total?.toLocaleString('de-DE') ?? 'N/A'}`);
    console.log(`    Asien: ${record.regions.asien.total?.toLocaleString('de-DE') ?? 'N/A'}`);
    console.log(`    Afrika: ${record.regions.afrika.total?.toLocaleString('de-DE') ?? 'N/A'}`);
  });

  console.log('\n✓ Done!');
}

processAuslaenderDetailed().catch(console.error);
