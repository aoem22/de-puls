import type { BundeslandSlugEntry } from './types';

const BUNDESLAND_ENTRIES: BundeslandSlugEntry[] = [
  { code: '01', slug: 'schleswig-holstein', name: 'Schleswig-Holstein' },
  { code: '02', slug: 'hamburg', name: 'Hamburg' },
  { code: '03', slug: 'niedersachsen', name: 'Niedersachsen' },
  { code: '04', slug: 'bremen', name: 'Bremen' },
  { code: '05', slug: 'nordrhein-westfalen', name: 'Nordrhein-Westfalen' },
  { code: '06', slug: 'hessen', name: 'Hessen' },
  { code: '07', slug: 'rheinland-pfalz', name: 'Rheinland-Pfalz' },
  { code: '08', slug: 'baden-wuerttemberg', name: 'Baden-Württemberg' },
  { code: '09', slug: 'bayern', name: 'Bayern' },
  { code: '10', slug: 'saarland', name: 'Saarland' },
  { code: '11', slug: 'berlin', name: 'Berlin' },
  { code: '12', slug: 'brandenburg', name: 'Brandenburg' },
  { code: '13', slug: 'mecklenburg-vorpommern', name: 'Mecklenburg-Vorpommern' },
  { code: '14', slug: 'sachsen', name: 'Sachsen' },
  { code: '15', slug: 'sachsen-anhalt', name: 'Sachsen-Anhalt' },
  { code: '16', slug: 'thueringen', name: 'Thüringen' },
];

export const BUNDESLAND_BY_SLUG: Record<string, BundeslandSlugEntry> = Object.fromEntries(
  BUNDESLAND_ENTRIES.map((e) => [e.slug, e])
);

export const BUNDESLAND_BY_CODE: Record<string, BundeslandSlugEntry> = Object.fromEntries(
  BUNDESLAND_ENTRIES.map((e) => [e.code, e])
);

export const ALL_BUNDESLAND_SLUGS: string[] = BUNDESLAND_ENTRIES.map((e) => e.slug);

export const ALL_BUNDESLAENDER: BundeslandSlugEntry[] = BUNDESLAND_ENTRIES;
