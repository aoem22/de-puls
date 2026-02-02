export interface DistrictData {
  id: string;
  name: string;

  // Demographics
  population: number;
  female: number | null;
  male: number | null;

  // Age groups
  age_0_17: number | null;
  age_15_24: number | null;
  age_18_65: number | null;
  age_66_plus: number | null;
  age_75_plus: number | null;

  // Migration/Nationality
  german: number | null;
  foreign: number | null;
  migrationBackground: number | null;

  // Poverty indices (standardized z-scores)
  armutsindex: number | null;
  kinderarmut: number | null;
  kinderarmutAbsolute: number | null;
  erwachsenenarmut: number | null;
  erwachsenenarmutAbsolute: number | null;
  altersarmut: number | null;
  altersarmutAbsolute: number | null;

  // Household data
  households: number | null;
  householdsWithChildren: number | null;
  coupleHouseholdsWithChildren: number | null;

  // Single parent data
  singleParentHouseholds: number | null;
  singleParentFemale: number | null;
  singleParentMale: number | null;
  singleParentSGBII: number | null;

  // Youth unemployment
  youthSGBIIIndex: number | null;
  youthSGBIIAbsolute: number | null;
  youthUnemployedIndex: number | null;
  youthUnemployedAbsolute: number | null;

  // Welfare benefits
  transferleistungIndex: number | null;
  transferleistungAbsolute: number | null;

  // Housing benefits
  wohngeldHouseholds: number | null;
  wohngeldHouseholdsWithChildren: number | null;
  wohngeldSingleParent: number | null;
}

export type MetricKey =
  | 'armutsindex'
  | 'kinderarmut'
  | 'erwachsenenarmut'
  | 'altersarmut'
  | 'youthSGBIIIndex'
  | 'youthUnemployedIndex'
  | 'transferleistungIndex'
  | 'population'
  | 'migrationBackground'
  | 'singleParentHouseholds';

export interface MetricConfig {
  key: MetricKey;
  label: string;
  labelDe: string;
  description: string;
  unit: string;
  isDiverging: boolean; // true for indices (centered at 0), false for population
  format: (value: number | null) => string;
}

export const METRICS: Record<MetricKey, MetricConfig> = {
  armutsindex: {
    key: 'armutsindex',
    label: 'Poverty Index',
    labelDe: 'Armutsindex',
    description: 'Combined poverty index based on child, adult, and elderly poverty',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  kinderarmut: {
    key: 'kinderarmut',
    label: 'Child Poverty',
    labelDe: 'Kinderarmut',
    description: 'Indicator measuring child poverty (ages 0-17)',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  erwachsenenarmut: {
    key: 'erwachsenenarmut',
    label: 'Adult Poverty',
    labelDe: 'Erwachsenenarmut',
    description: 'Indicator measuring unemployed adults receiving benefits (ages 18-65)',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  altersarmut: {
    key: 'altersarmut',
    label: 'Elderly Poverty',
    labelDe: 'Altersarmut',
    description: 'Indicator measuring elderly poverty (ages 66+)',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  youthSGBIIIndex: {
    key: 'youthSGBIIIndex',
    label: 'Youth Welfare',
    labelDe: 'Jugend SGB II',
    description: 'Youth (15-24) receiving SGB II welfare benefits',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  youthUnemployedIndex: {
    key: 'youthUnemployedIndex',
    label: 'Youth Unemployment',
    labelDe: 'Jugendarbeitslosigkeit',
    description: 'Youth (15-24) registered as unemployed or job-seeking',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  transferleistungIndex: {
    key: 'transferleistungIndex',
    label: 'Welfare Recipients',
    labelDe: 'Transferleistungsbezug',
    description: 'Residents receiving welfare transfer payments',
    unit: '',
    isDiverging: true,
    format: (v) => v !== null ? v.toFixed(2) : 'N/A',
  },
  population: {
    key: 'population',
    label: 'Population',
    labelDe: 'Einwohner',
    description: 'Total population of the district',
    unit: '',
    isDiverging: false,
    format: (v) => v !== null ? v.toLocaleString('de-DE') : 'N/A',
  },
  migrationBackground: {
    key: 'migrationBackground',
    label: 'Migration Background',
    labelDe: 'Migrationshintergrund',
    description: 'Residents with migration background',
    unit: '',
    isDiverging: false,
    format: (v) => v !== null ? v.toLocaleString('de-DE') : 'N/A',
  },
  singleParentHouseholds: {
    key: 'singleParentHouseholds',
    label: 'Single Parents',
    labelDe: 'Alleinerziehende',
    description: 'Single-parent households',
    unit: '',
    isDiverging: false,
    format: (v) => v !== null ? v.toLocaleString('de-DE') : 'N/A',
  },
};
