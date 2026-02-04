/**
 * Process Deutschlandatlas data (54 social indicators at Kreis level)
 * Source: Deutschlandatlas-Daten.xlsx (Deutschlandatlas_KRS1222 sheet)
 *
 * Output: lib/data/indicators/deutschlandatlas.json
 *
 * Usage: npx tsx scripts/process-deutschlandatlas.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const INPUT_FILE = '/Users/alanozalp/Downloads/Deutschlandatlas-Daten.xlsx';
const OUTPUT_DIR = path.join(__dirname, '../lib/data/indicators');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'deutschlandatlas.json');

/**
 * Indicator metadata with German/English labels, units, and categories
 */
export const INDICATOR_META: Record<
  string,
  {
    labelDe: string;
    label: string;
    unit: string;
    unitDe: string;
    category: string;
    categoryDe: string;
    description: string;
    descriptionDe: string;
    isClassified?: boolean; // If value is a classified range, not exact number
    higherIsBetter?: boolean; // For color scale direction
  }
> = {
  // Land Use (Wo wir leben)
  fl_suv: {
    labelDe: 'Siedlungs-/Verkehrsfläche',
    label: 'Urban Area',
    unit: '%',
    unitDe: '%',
    category: 'Land Use',
    categoryDe: 'Flächennutzung',
    description: 'Settlement and traffic area as % of total area',
    descriptionDe: 'Siedlungs- und Verkehrsfläche in % der Gesamtfläche',
  },
  fl_landw: {
    labelDe: 'Landwirtschaftsfläche',
    label: 'Agricultural Land',
    unit: '%',
    unitDe: '%',
    category: 'Land Use',
    categoryDe: 'Flächennutzung',
    description: 'Agricultural area as % of total area',
    descriptionDe: 'Landwirtschaftsfläche in % der Gesamtfläche',
  },
  fl_wald: {
    labelDe: 'Waldfläche',
    label: 'Forest Area',
    unit: '%',
    unitDe: '%',
    category: 'Land Use',
    categoryDe: 'Flächennutzung',
    description: 'Forest area as % of total area',
    descriptionDe: 'Waldfläche in % der Gesamtfläche',
  },

  // Demographics (Wer wir sind)
  bev_binw: {
    labelDe: 'Binnenwanderung',
    label: 'Internal Migration',
    unit: 'per 10k',
    unitDe: 'je 10.000',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'Internal migration balance per 10,000 inhabitants',
    descriptionDe: 'Binnenwanderungssaldo je 10.000 Einwohner',
  },
  bev_ausw: {
    labelDe: 'Außenwanderung',
    label: 'External Migration',
    unit: 'per 10k',
    unitDe: 'je 10.000',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'External migration balance per 10,000 inhabitants',
    descriptionDe: 'Außenwanderungssaldo je 10.000 Einwohner',
  },
  ko_kasskred: {
    labelDe: 'Kassenkredite',
    label: 'Municipal Cash Credits',
    unit: '€/capita',
    unitDe: '€/Einwohner',
    category: 'Municipal Finance',
    categoryDe: 'Kommunalfinanzen',
    description: 'Municipal cash credits per capita',
    descriptionDe: 'Kassenkredite je Einwohner',
  },
  bev_u18: {
    labelDe: 'Unter 18 Jahre',
    label: 'Under 18',
    unit: '%',
    unitDe: '%',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'Population under 18 years as %',
    descriptionDe: 'Anteil der Bevölkerung unter 18 Jahren',
    higherIsBetter: true,
  },
  bev_18_65: {
    labelDe: '18-65 Jahre',
    label: 'Working Age (18-65)',
    unit: '%',
    unitDe: '%',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'Working age population (18-65) as %',
    descriptionDe: 'Anteil der Bevölkerung im erwerbsfähigen Alter',
    higherIsBetter: true,
  },
  bev_ue65: {
    labelDe: 'Über 65 Jahre',
    label: 'Over 65',
    unit: '%',
    unitDe: '%',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'Population over 65 years as %',
    descriptionDe: 'Anteil der Bevölkerung über 65 Jahren',
  },
  bev_ausl: {
    labelDe: 'Ausländeranteil',
    label: 'Foreign Population',
    unit: '%',
    unitDe: '%',
    category: 'Demographics',
    categoryDe: 'Demografie',
    description: 'Foreign population as % of total',
    descriptionDe: 'Ausländeranteil an der Bevölkerung',
  },
  mitgl_sportv: {
    labelDe: 'Sportvereinsmitglieder',
    label: 'Sports Club Members',
    unit: 'per 100',
    unitDe: 'je 100 Einw.',
    category: 'Social Participation',
    categoryDe: 'Soziale Teilhabe',
    description: 'Sports club members per 100 inhabitants',
    descriptionDe: 'Mitglieder in Sportvereinen je 100 Einwohner',
    higherIsBetter: true,
  },
  ew_sportv: {
    labelDe: 'Einwohner je Sportverein',
    label: 'Inhabitants per Sports Club',
    unit: '',
    unitDe: '',
    category: 'Social Participation',
    categoryDe: 'Soziale Teilhabe',
    description: 'Number of inhabitants per sports club',
    descriptionDe: 'Einwohner je Sportverein',
  },
  wahl_beteil: {
    labelDe: 'Wahlbeteiligung',
    label: 'Voter Turnout',
    unit: '%',
    unitDe: '%',
    category: 'Social Participation',
    categoryDe: 'Soziale Teilhabe',
    description: 'Voter turnout in federal elections',
    descriptionDe: 'Wahlbeteiligung bei Bundestagswahlen',
    higherIsBetter: true,
  },

  // Housing (Wie wir wohnen)
  preis_miet: {
    labelDe: 'Mietpreise',
    label: 'Rent Prices',
    unit: '€/m²',
    unitDe: '€/m²',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'Median rent prices per m²',
    descriptionDe: 'Median-Mietpreise je m²',
    isClassified: true,
  },
  wohn_eigen: {
    labelDe: 'Wohneigentumsquote',
    label: 'Home Ownership',
    unit: '%',
    unitDe: '%',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'Share of households owning their home',
    descriptionDe: 'Anteil der Haushalte mit Wohneigentum',
    higherIsBetter: true,
  },
  wohn_leer: {
    labelDe: 'Leerstandsquote',
    label: 'Vacancy Rate',
    unit: '%',
    unitDe: '%',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'Share of vacant apartments',
    descriptionDe: 'Anteil leerstehender Wohnungen',
  },
  wohn_EZFH: {
    labelDe: 'Neue Ein-/Zweifamilienhäuser',
    label: 'New 1-2 Family Homes',
    unit: 'per 10k',
    unitDe: 'je 10.000',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'New 1-2 family homes per 10,000 inhabitants',
    descriptionDe: 'Neue Ein- und Zweifamilienhäuser je 10.000 Einwohner',
    higherIsBetter: true,
  },
  wohn_MFH: {
    labelDe: 'Neue Mehrfamilienhäuser',
    label: 'New Apartment Buildings',
    unit: 'per 10k',
    unitDe: 'je 10.000',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'New multi-family homes per 10,000 inhabitants',
    descriptionDe: 'Neue Mehrfamilienhäuser je 10.000 Einwohner',
    higherIsBetter: true,
  },
  heiz_wohn_best: {
    labelDe: 'Erneuerbare Heizung (Bestand)',
    label: 'Renewable Heating (Existing)',
    unit: '%',
    unitDe: '%',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'Share of existing homes with renewable heating',
    descriptionDe: 'Anteil Bestandsgebäude mit erneuerbarer Heizung',
    higherIsBetter: true,
  },
  heiz_wohn: {
    labelDe: 'Erneuerbare Heizung (Neubau)',
    label: 'Renewable Heating (New)',
    unit: '%',
    unitDe: '%',
    category: 'Housing',
    categoryDe: 'Wohnen',
    description: 'Share of new homes with renewable heating',
    descriptionDe: 'Anteil Neubauten mit erneuerbarer Heizung',
    higherIsBetter: true,
  },

  // Employment & Qualification (Wie wir arbeiten)
  bquali_unifh: {
    labelDe: 'Akademiker',
    label: 'University Degree',
    unit: '%',
    unitDe: '%',
    category: 'Qualification',
    categoryDe: 'Qualifikation',
    description: 'Share of employees with university degree',
    descriptionDe: 'Anteil Beschäftigte mit Hochschulabschluss',
    higherIsBetter: true,
  },
  bquali_mabschl: {
    labelDe: 'Berufsausbildung',
    label: 'Vocational Training',
    unit: '%',
    unitDe: '%',
    category: 'Qualification',
    categoryDe: 'Qualifikation',
    description: 'Share of employees with vocational training',
    descriptionDe: 'Anteil Beschäftigte mit Berufsausbildung',
    higherIsBetter: true,
  },
  bquali_oabschl: {
    labelDe: 'Ohne Abschluss',
    label: 'Without Qualification',
    unit: '%',
    unitDe: '%',
    category: 'Qualification',
    categoryDe: 'Qualifikation',
    description: 'Share of employees without qualification',
    descriptionDe: 'Anteil Beschäftigte ohne Berufsabschluss',
    higherIsBetter: false,
  },
  erw_wachs: {
    labelDe: 'Beschäftigungswachstum',
    label: 'Employment Growth',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Employment growth rate',
    descriptionDe: 'Wachstumsrate der Beschäftigung',
    higherIsBetter: true,
  },
  erw_vol: {
    labelDe: 'Vollzeitäquivalente',
    label: 'Full-time Equivalents',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Full-time equivalent employment rate',
    descriptionDe: 'Vollzeitäquivalent-Beschäftigungsquote',
  },
  erw_mini: {
    labelDe: 'Minijobs',
    label: 'Mini Jobs',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Share of employees in mini jobs',
    descriptionDe: 'Anteil Beschäftigte in Minijobs',
    higherIsBetter: false,
  },
  erw_minineben: {
    labelDe: 'Minijobs als Nebenjob',
    label: 'Mini Jobs (Secondary)',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Share of mini jobs as secondary employment',
    descriptionDe: 'Anteil Minijobs im Nebenerwerb',
  },
  teilz_insg: {
    labelDe: 'Teilzeit gesamt',
    label: 'Part-time (Total)',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Share of part-time employees (total)',
    descriptionDe: 'Anteil Teilzeitbeschäftigte (gesamt)',
  },
  teilz_w: {
    labelDe: 'Teilzeit Frauen',
    label: 'Part-time (Women)',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Share of women working part-time',
    descriptionDe: 'Anteil teilzeitbeschäftigte Frauen',
  },
  teilz_m: {
    labelDe: 'Teilzeit Männer',
    label: 'Part-time (Men)',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Share of men working part-time',
    descriptionDe: 'Anteil teilzeitbeschäftigte Männer',
  },
  erw_bip: {
    labelDe: 'BIP je Erwerbstätigen',
    label: 'GDP per Worker',
    unit: '€1000',
    unitDe: '1.000 €',
    category: 'Economy',
    categoryDe: 'Wirtschaft',
    description: 'GDP per employed person in thousands €',
    descriptionDe: 'Bruttoinlandsprodukt je Erwerbstätigen',
    higherIsBetter: true,
  },
  alq: {
    labelDe: 'Arbeitslosenquote',
    label: 'Unemployment Rate',
    unit: '%',
    unitDe: '%',
    category: 'Employment',
    categoryDe: 'Beschäftigung',
    description: 'Unemployment rate',
    descriptionDe: 'Arbeitslosenquote',
    higherIsBetter: false,
  },
  hh_veink: {
    labelDe: 'Verfügbares Einkommen',
    label: 'Disposable Income',
    unit: '€1000',
    unitDe: '1.000 €',
    category: 'Economy',
    categoryDe: 'Wirtschaft',
    description: 'Disposable household income per capita in thousands €',
    descriptionDe: 'Verfügbares Haushaltseinkommen je Einwohner',
    higherIsBetter: true,
  },

  // Social Security
  elterng_v: {
    labelDe: 'Väter in Elternzeit',
    label: 'Fathers on Parental Leave',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of fathers taking parental leave',
    descriptionDe: 'Anteil Väter in Elternzeit',
    higherIsBetter: true,
  },
  schulden: {
    labelDe: 'Überschuldung',
    label: 'Over-indebted',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of over-indebted adults',
    descriptionDe: 'Anteil überschuldeter Erwachsener',
    higherIsBetter: false,
  },
  grusi_insg: {
    labelDe: 'Grundsicherung (gesamt)',
    label: 'Basic Security (Total)',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of 65+ receiving basic security',
    descriptionDe: 'Anteil Ü65 mit Grundsicherung',
    higherIsBetter: false,
  },
  grusi_w: {
    labelDe: 'Grundsicherung Frauen',
    label: 'Basic Security (Women)',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of women 65+ receiving basic security',
    descriptionDe: 'Anteil Frauen Ü65 mit Grundsicherung',
    higherIsBetter: false,
  },
  grusi_m: {
    labelDe: 'Grundsicherung Männer',
    label: 'Basic Security (Men)',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of men 65+ receiving basic security',
    descriptionDe: 'Anteil Männer Ü65 mit Grundsicherung',
    higherIsBetter: false,
  },
  sozsich: {
    labelDe: 'Sozialleistungsquote',
    label: 'Social Welfare Rate',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of population receiving social welfare',
    descriptionDe: 'Anteil Bevölkerung mit Sozialleistungsbezug',
    higherIsBetter: false,
  },

  // Mobility
  auto: {
    labelDe: 'PKW-Dichte',
    label: 'Car Density',
    unit: 'per 1k',
    unitDe: 'je 1.000',
    category: 'Mobility',
    categoryDe: 'Mobilität',
    description: 'Cars per 1,000 inhabitants',
    descriptionDe: 'PKW je 1.000 Einwohner',
  },
  elade: {
    labelDe: 'Ladesäulen',
    label: 'EV Charging Points',
    unit: 'per 100k',
    unitDe: 'je 100.000',
    category: 'Mobility',
    categoryDe: 'Mobilität',
    description: 'EV charging points per 100,000 inhabitants',
    descriptionDe: 'Ladesäulen je 100.000 Einwohner',
    higherIsBetter: true,
  },
  eauto: {
    labelDe: 'Elektroautos',
    label: 'Electric Cars',
    unit: '%',
    unitDe: '%',
    category: 'Mobility',
    categoryDe: 'Mobilität',
    description: 'Share of battery electric vehicles in car fleet',
    descriptionDe: 'Anteil Batterieelektrofahrzeuge am PKW-Bestand',
    higherIsBetter: true,
  },

  // Healthcare
  v_harzt: {
    labelDe: 'Hausärzte',
    label: 'General Practitioners',
    unit: 'per 100k',
    unitDe: 'je 100.000',
    category: 'Healthcare',
    categoryDe: 'Gesundheit',
    description: 'GPs per 100,000 inhabitants',
    descriptionDe: 'Hausärzte je 100.000 Einwohner',
    higherIsBetter: true,
  },
  v_karzt: {
    labelDe: 'Kinderärzte',
    label: 'Pediatricians',
    unit: 'per 100k U15',
    unitDe: 'je 100.000 U15',
    category: 'Healthcare',
    categoryDe: 'Gesundheit',
    description: 'Pediatricians per 100,000 under-15',
    descriptionDe: 'Kinderärzte je 100.000 Unter-15-Jährige',
    higherIsBetter: true,
  },

  // Education
  schule_oabschl: {
    labelDe: 'Schulabbrecher',
    label: 'School Dropouts',
    unit: '%',
    unitDe: '%',
    category: 'Education',
    categoryDe: 'Bildung',
    description: 'Share leaving school without diploma',
    descriptionDe: 'Anteil Schulabgänger ohne Abschluss',
    higherIsBetter: false,
  },
  kbetr_u3: {
    labelDe: 'Kita-Betreuung U3',
    label: 'Childcare Under 3',
    unit: '%',
    unitDe: '%',
    category: 'Education',
    categoryDe: 'Bildung',
    description: 'Share of under-3s in childcare',
    descriptionDe: 'Betreuungsquote Unter-3-Jährige',
    higherIsBetter: true,
  },
  kbetr_ue3: {
    labelDe: 'Kita-Betreuung 3-6',
    label: 'Childcare 3-6',
    unit: '%',
    unitDe: '%',
    category: 'Education',
    categoryDe: 'Bildung',
    description: 'Share of 3-6 year olds in childcare',
    descriptionDe: 'Betreuungsquote 3-6-Jährige',
    higherIsBetter: true,
  },
  kbetr_ue6: {
    labelDe: 'Hortbetreuung 6-11',
    label: 'Afterschool 6-11',
    unit: '%',
    unitDe: '%',
    category: 'Education',
    categoryDe: 'Bildung',
    description: 'Share of 6-11 year olds in afterschool care',
    descriptionDe: 'Betreuungsquote 6-11-Jährige',
    higherIsBetter: true,
  },
  kbtr_pers: {
    labelDe: 'Betreuungsschlüssel',
    label: 'Childcare Ratio',
    unit: 'children/staff',
    unitDe: 'Kinder/Personal',
    category: 'Education',
    categoryDe: 'Bildung',
    description: 'Children per childcare staff member',
    descriptionDe: 'Kinder je Betreuungsperson',
    higherIsBetter: false,
  },
  kinder_bg: {
    labelDe: 'Kinderarmut',
    label: 'Child Poverty',
    unit: '%',
    unitDe: '%',
    category: 'Social Security',
    categoryDe: 'Soziale Sicherung',
    description: 'Share of children in welfare households',
    descriptionDe: 'Anteil Kinder in Bedarfsgemeinschaften',
    higherIsBetter: false,
  },

  // Security
  straft: {
    labelDe: 'Straftaten',
    label: 'Crime Rate',
    unit: 'per 100k',
    unitDe: 'je 100.000',
    category: 'Security',
    categoryDe: 'Sicherheit',
    description: 'Crimes per 100,000 inhabitants',
    descriptionDe: 'Straftaten je 100.000 Einwohner',
    higherIsBetter: false,
  },
  einbr: {
    labelDe: 'Einbrüche',
    label: 'Burglaries',
    unit: 'per 100k',
    unitDe: 'je 100.000',
    category: 'Security',
    categoryDe: 'Sicherheit',
    description: 'Burglaries per 100,000 inhabitants',
    descriptionDe: 'Wohnungseinbrüche je 100.000 Einwohner',
    higherIsBetter: false,
  },
};

// Indicator keys from the KRS sheet header
const INDICATOR_KEYS = Object.keys(INDICATOR_META);

interface KreisRecord {
  ags: string;
  name: string;
  indicators: Record<string, number | null>;
}

interface DeutschlandatlasData {
  meta: {
    source: string;
    description: string;
    geoLevel: 'kreis';
    year: string;
    indicatorMeta: typeof INDICATOR_META;
    indicatorKeys: string[];
    categories: string[];
  };
  data: Record<string, KreisRecord>; // ags -> record
}

function parseValue(val: unknown): number | null {
  if (val === '-' || val === '.' || val === '...' || val === null || val === undefined) {
    return null;
  }
  // Check for -9999 (missing value code in Deutschlandatlas)
  if (typeof val === 'number' && val === -9999) {
    return null;
  }
  if (typeof val === 'number') return val;
  const str = String(val).replace(/\s/g, '');
  if (str === '-9999') return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function normalizeAgs(ags: number | string): string {
  const agsStr = String(ags);
  // KRS codes in Deutschlandatlas are 7 digits like 1001000 for Flensburg
  // GeoJSON uses 5-digit format: 01001
  // The Excel format is: KKKKKKK where last 3 digits are always 000
  // So we drop the last 3 digits and pad to 5
  if (agsStr.length === 7) {
    // Format: 1001000 -> 1001 -> 01001
    const kreisCode = agsStr.slice(0, -3); // Drop last 3 chars (000)
    return kreisCode.padStart(5, '0');
  }
  if (agsStr.length === 5) {
    return agsStr.padStart(5, '0');
  }
  // Handle edge cases - assume same pattern
  return agsStr.padStart(5, '0');
}

async function processDeutschlandatlas(): Promise<void> {
  console.log('Reading Deutschlandatlas Excel file...');
  const workbook = XLSX.readFile(INPUT_FILE);

  // Use the KRS1222 sheet (Kreis-level data from 2022)
  const sheetName = 'Deutschlandatlas_KRS1222';
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    console.error(`Sheet "${sheetName}" not found!`);
    console.log('Available sheets:', workbook.SheetNames);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  console.log(`Total rows: ${rows.length}`);

  // Get header row to map column indices
  const header = rows[0] as string[];
  console.log('Header columns:', header.length);

  // Build column index map
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    colIndex[header[i]] = i;
  }

  // Verify we have all expected indicators
  const missingIndicators: string[] = [];
  for (const key of INDICATOR_KEYS) {
    if (!(key in colIndex)) {
      missingIndicators.push(key);
    }
  }
  if (missingIndicators.length > 0) {
    console.log('Missing indicators:', missingIndicators);
  }

  // Get unique categories
  const categories = [...new Set(Object.values(INDICATOR_META).map((m) => m.categoryDe))];

  const result: DeutschlandatlasData = {
    meta: {
      source: 'Deutschlandatlas / BMUV',
      description: 'Sozialindikatoren auf Kreisebene',
      geoLevel: 'kreis',
      year: '2022',
      indicatorMeta: INDICATOR_META,
      indicatorKeys: INDICATOR_KEYS,
      categories,
    },
    data: {},
  };

  // Process data rows (skip header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const krsCode = row[colIndex['KRS1222']];
    const kreisName = row[colIndex['Kreisname']];

    if (!krsCode) continue;

    const ags = normalizeAgs(krsCode);

    const record: KreisRecord = {
      ags,
      name: String(kreisName || ''),
      indicators: {},
    };

    // Extract all indicators
    for (const key of INDICATOR_KEYS) {
      if (key in colIndex) {
        record.indicators[key] = parseValue(row[colIndex[key]]);
      } else {
        record.indicators[key] = null;
      }
    }

    result.data[ags] = record;
  }

  const kreisCount = Object.keys(result.data).length;
  console.log(`Processed ${kreisCount} Kreise`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write output (no pretty printing for smaller size)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result));

  const stats = fs.statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log('\n=== Summary ===');
  console.log(`Kreise: ${kreisCount}`);
  console.log(`Indicators: ${INDICATOR_KEYS.length}`);
  console.log(`Categories: ${categories.length}`);
  console.log(`File size: ${sizeKB} KB`);
  console.log(`Output: ${OUTPUT_FILE}`);

  // Sample data (sort by AGS for predictable output)
  console.log('\n=== Sample Data ===');
  const sortedAgs = Object.keys(result.data).sort();
  const sampleAgs = sortedAgs.slice(0, 3);
  sampleAgs.forEach((ags) => {
    const record = result.data[ags];
    console.log(`\n  ${ags}: ${record.name}`);
    console.log(`    Arbeitslosenquote: ${record.indicators.alq ?? 'N/A'}%`);
    console.log(`    Kinderarmut: ${record.indicators.kinder_bg ?? 'N/A'}%`);
    console.log(`    Ausländeranteil: ${record.indicators.bev_ausl ?? 'N/A'}%`);
    console.log(`    Verfügbares Einkommen: ${record.indicators.hh_veink ?? 'N/A'} €1000`);
    console.log(`    Straftaten: ${record.indicators.straft?.toFixed(0) ?? 'N/A'} je 100k`);
  });

  console.log('\n✓ Done!');
}

processDeutschlandatlas().catch(console.error);
