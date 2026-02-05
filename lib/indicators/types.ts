/**
 * Indicator System Types
 *
 * Supports multi-granularity indicators with different geographic levels.
 * Each indicator knows its own geographic level (kreis, bundesland, etc.)
 */

import type { GeoLevel } from '../geo/types';
import { CITY_CRIME_TYPES, CRIME_CATEGORIES_META, type CrimeTypeKey, type CrimeCategory } from '../types/cityCrime';

/**
 * Unique identifier for each indicator type
 */
export type IndicatorKey = 'auslaender' | 'deutschlandatlas' | 'kriminalstatistik' | 'blaulicht';

/**
 * Sub-metric within an indicator (e.g., region keys for Ausländer, or indicator keys for Deutschlandatlas)
 */
export type SubMetricKey = string;

// ============ Ausländer Indicator Types ============

/**
 * Region keys for Ausländer data
 */
export const AUSLAENDER_REGION_KEYS = [
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

export type AuslaenderRegionKey = (typeof AUSLAENDER_REGION_KEYS)[number];

/**
 * Metadata for each region (for UI display)
 */
export const AUSLAENDER_REGION_META: Record<
  AuslaenderRegionKey,
  { labelDe: string; label: string; category: string }
> = {
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

/**
 * Get regions grouped by category for dropdown display
 */
export function getAuslaenderRegionsByCategory(): Map<string, { key: AuslaenderRegionKey; labelDe: string }[]> {
  const categories = new Map<string, { key: AuslaenderRegionKey; labelDe: string }[]>();

  for (const key of AUSLAENDER_REGION_KEYS) {
    const meta = AUSLAENDER_REGION_META[key];
    if (!categories.has(meta.category)) {
      categories.set(meta.category, []);
    }
    categories.get(meta.category)!.push({ key, labelDe: meta.labelDe });
  }

  return categories;
}

// ============ Deutschlandatlas Indicator Types ============

/**
 * Deutschlandatlas indicator keys (52 social indicators at Kreis level)
 */
export const DEUTSCHLANDATLAS_KEYS = [
  // Land Use
  'fl_suv', 'fl_landw', 'fl_wald',
  // Demographics
  'bev_binw', 'bev_ausw', 'ko_kasskred', 'bev_u18', 'bev_18_65', 'bev_ue65', 'bev_ausl',
  'mitgl_sportv', 'ew_sportv', 'wahl_beteil',
  // Housing
  'preis_miet', 'wohn_eigen', 'wohn_leer', 'wohn_EZFH', 'wohn_MFH', 'heiz_wohn_best', 'heiz_wohn',
  // Employment & Qualification
  'bquali_unifh', 'bquali_mabschl', 'bquali_oabschl', 'erw_wachs', 'erw_vol', 'erw_mini',
  'erw_minineben', 'teilz_insg', 'teilz_w', 'teilz_m', 'erw_bip', 'alq', 'hh_veink',
  // Social Security
  'elterng_v', 'schulden', 'grusi_insg', 'grusi_w', 'grusi_m', 'sozsich', 'kinder_bg',
  // Mobility
  'auto', 'elade', 'eauto',
  // Healthcare
  'v_harzt', 'v_karzt',
  // Education
  'schule_oabschl', 'kbetr_u3', 'kbetr_ue3', 'kbetr_ue6', 'kbtr_pers',
  // Security
  'straft', 'einbr',
] as const;

export type DeutschlandatlasKey = (typeof DEUTSCHLANDATLAS_KEYS)[number];

/**
 * Category definitions for Deutschlandatlas indicators
 */
export const DEUTSCHLANDATLAS_CATEGORIES = [
  'Flächennutzung',
  'Demografie',
  'Soziale Teilhabe',
  'Wohnen',
  'Qualifikation',
  'Beschäftigung',
  'Wirtschaft',
  'Soziale Sicherung',
  'Mobilität',
  'Gesundheit',
  'Bildung',
  'Sicherheit',
  'Kommunalfinanzen',
] as const;

export type DeutschlandatlasCategory = (typeof DEUTSCHLANDATLAS_CATEGORIES)[number];

/**
 * Metadata for each Deutschlandatlas indicator
 */
export interface DeutschlandatlasIndicatorMeta {
  labelDe: string;
  label: string;
  unit: string;
  unitDe: string;
  category: string;
  categoryDe: DeutschlandatlasCategory;
  description: string;
  descriptionDe: string;
  isClassified?: boolean;
  higherIsBetter?: boolean;
}

/**
 * Full metadata for all Deutschlandatlas indicators
 */
export const DEUTSCHLANDATLAS_META: Record<DeutschlandatlasKey, DeutschlandatlasIndicatorMeta> = {
  // Land Use
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

  // Demographics
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

  // Housing
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

  // Qualification
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

  // Employment
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

  // Economy
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

/**
 * Get Deutschlandatlas indicators grouped by category
 */
export function getDeutschlandatlasByCategory(): Map<DeutschlandatlasCategory, { key: DeutschlandatlasKey; labelDe: string }[]> {
  const categories = new Map<DeutschlandatlasCategory, { key: DeutschlandatlasKey; labelDe: string }[]>();

  for (const key of DEUTSCHLANDATLAS_KEYS) {
    const meta = DEUTSCHLANDATLAS_META[key];
    if (!categories.has(meta.categoryDe)) {
      categories.set(meta.categoryDe, []);
    }
    categories.get(meta.categoryDe)!.push({ key, labelDe: meta.labelDe });
  }

  return categories;
}

// ============ Common Indicator Types ============

/**
 * Configuration for a sub-metric
 */
export interface SubMetricConfig {
  key: SubMetricKey;
  label: string;
  labelDe: string;
}

/**
 * Configuration for an indicator
 */
export interface IndicatorConfig {
  key: IndicatorKey;
  label: string;
  labelDe: string;
  description: string;
  descriptionDe: string;
  geoLevel: GeoLevel;
  unit: string;
  source: string;
  subMetrics: SubMetricConfig[];
  defaultSubMetric: SubMetricKey;
  colorScheme: 'sequential' | 'diverging' | 'semantic' | 'monochrome';
  hasDetailedBreakdown: boolean;
}

/**
 * Registry of all available indicators
 */
export const INDICATORS: Record<IndicatorKey, IndicatorConfig> = {
  auslaender: {
    key: 'auslaender',
    label: 'Foreigners',
    labelDe: 'Ausländer',
    description: 'Foreign population by district and region of origin',
    descriptionDe: 'Ausländische Bevölkerung nach Kreisen und Herkunftsregion',
    geoLevel: 'kreis',
    unit: 'Anzahl',
    source: 'DESTATIS 12521-0041',
    subMetrics: AUSLAENDER_REGION_KEYS.map((key) => ({
      key,
      label: AUSLAENDER_REGION_META[key].label,
      labelDe: AUSLAENDER_REGION_META[key].labelDe,
    })),
    defaultSubMetric: 'total',
    colorScheme: 'sequential',
    hasDetailedBreakdown: true,
  },
  deutschlandatlas: {
    key: 'deutschlandatlas',
    label: 'Deutschlandatlas',
    labelDe: 'Deutschlandatlas',
    description: '52 social indicators at district level',
    descriptionDe: '52 Sozialindikatoren auf Kreisebene',
    geoLevel: 'kreis',
    unit: 'varies',
    source: 'Deutschlandatlas / BMUV',
    subMetrics: DEUTSCHLANDATLAS_KEYS.map((key) => ({
      key,
      label: DEUTSCHLANDATLAS_META[key].label,
      labelDe: DEUTSCHLANDATLAS_META[key].labelDe,
    })),
    defaultSubMetric: 'kinder_bg', // Child poverty as default - relevant to project theme
    colorScheme: 'semantic', // Use semantic coloring based on higherIsBetter
    hasDetailedBreakdown: true,
  },
  kriminalstatistik: {
    key: 'kriminalstatistik',
    label: 'Crime Statistics',
    labelDe: 'Kriminalstatistik',
    description: 'Police crime statistics for major German cities',
    descriptionDe: 'Polizeiliche Kriminalstatistik für deutsche Großstädte',
    geoLevel: 'city',
    unit: 'pro 100.000 Einw.',
    source: 'PKS / BKA',
    subMetrics: CITY_CRIME_TYPES.map((crimeType) => ({
      key: crimeType.key,
      label: crimeType.label,
      labelDe: crimeType.labelDe,
    })),
    defaultSubMetric: 'total',
    colorScheme: 'sequential',
    hasDetailedBreakdown: true,
  },
  blaulicht: {
    key: 'blaulicht',
    label: 'Blaulicht',
    labelDe: 'Blaulicht',
    description: 'Real-time police reports from Presseportal',
    descriptionDe: 'Aktuelle Polizeimeldungen aus Presseportal',
    geoLevel: 'point',
    unit: 'Meldungen',
    source: 'Presseportal.de',
    subMetrics: [],
    defaultSubMetric: 'all',
    colorScheme: 'monochrome',
    hasDetailedBreakdown: false,
  },
};

/**
 * Check if a key is a valid Deutschlandatlas indicator
 */
export function isDeutschlandatlasKey(key: string): key is DeutschlandatlasKey {
  return DEUTSCHLANDATLAS_KEYS.includes(key as DeutschlandatlasKey);
}

