/**
 * Process Ausländer (foreigners) statistics from DESTATIS Excel
 * Source: 12521-0040_de.xlsx
 *
 * Output: lib/data/indicators/auslaender.json
 *
 * Usage: npx tsx scripts/process-auslaender.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const INPUT_FILE = '/Users/alanozalp/Downloads/12521-0040_de.xlsx';
const OUTPUT_DIR = path.join(__dirname, '../lib/data/indicators');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'auslaender.json');

interface AuslaenderRecord {
  ags: string;
  name: string;
  male: number | null;
  female: number | null;
  total: number | null;
}

interface AuslaenderData {
  meta: {
    source: string;
    description: string;
    geoLevel: 'kreis';
    unit: string;
    years: string[];
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
  // Pad to 5 digits for Kreis level
  return ags.padStart(5, '0');
}

async function processAuslaender(): Promise<void> {
  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(INPUT_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  console.log(`Total rows: ${rows.length}`);

  const result: AuslaenderData = {
    meta: {
      source: 'DESTATIS 12521-0040',
      description: 'Ausländer nach Kreisen, Geschlecht',
      geoLevel: 'kreis',
      unit: 'Anzahl',
      years: [],
    },
    data: {},
  };

  let currentYear: string | null = null;
  let skippedRows = 0;
  let processedRecords = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] || '').trim();

    // Check if this is a year header row (e.g., "31.12.1998")
    if (firstCell.match(/^31\.12\.\d{4}$/)) {
      currentYear = firstCell.replace('31.12.', '');
      result.data[currentYear] = {};
      result.meta.years.push(currentYear);
      console.log(`  Found year: ${currentYear}`);
      continue;
    }

    // Skip rows before first year or non-data rows
    if (!currentYear) continue;

    // Check if first cell looks like an AGS code (numeric, 4-5 digits)
    if (!/^\d{4,5}$/.test(firstCell)) continue;

    const ags = normalizeAgs(firstCell);
    const name = String(row[1] || '').trim();

    // Skip if no name or if it's a header row
    if (!name || name.toLowerCase().includes('kreise')) continue;

    // Parse values - columns: AGS, Name, Male, (flag), Female, (flag), Total, (flag)
    // The 'e' flags are in alternating columns
    const male = parseValue(row[2]);
    const female = parseValue(row[4]);
    const total = parseValue(row[6]);

    // Skip entries with all null values (merged/renamed Kreise)
    if (male === null && female === null && total === null) {
      skippedRows++;
      continue;
    }

    result.data[currentYear][ags] = {
      ags,
      name,
      male,
      female,
      total,
    };
    processedRecords++;
  }

  // Keep only recent years (last 10 years for manageable file size)
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

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

  const stats = fs.statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log('\n=== Summary ===');
  console.log(`Years included: ${recentYears.join(', ')}`);
  console.log(`Total records processed: ${processedRecords}`);
  console.log(`Skipped rows (no data): ${skippedRows}`);
  console.log(`File size: ${sizeKB} KB`);
  console.log(`Output: ${OUTPUT_FILE}`);

  // Sample data
  const latestYear = recentYears[recentYears.length - 1];
  const latestData = result.data[latestYear];
  const sampleAgs = Object.keys(latestData).slice(0, 5);
  console.log(`\n=== Sample Data (${latestYear}) ===`);
  sampleAgs.forEach((ags) => {
    const record = latestData[ags];
    console.log(`  ${ags}: ${record.name} - Total: ${record.total?.toLocaleString('de-DE') ?? 'N/A'}`);
  });

  console.log('\n✓ Done!');
}

processAuslaender().catch(console.error);
