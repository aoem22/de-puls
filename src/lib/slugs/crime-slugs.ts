import type { CrimeCategory } from '../types/crime';
import type { CrimeSlugEntry } from './types';

const CRIME_SLUG_ENTRIES: CrimeSlugEntry[] = [
  { key: 'murder', slug: 'mord', label: 'Tötungsdelikt' },
  { key: 'knife', slug: 'messerangriff', label: 'Messerangriff' },
  { key: 'weapons', slug: 'waffen', label: 'Waffen' },
  { key: 'sexual', slug: 'sexualdelikte', label: 'Sexualdelikte' },
  { key: 'assault', slug: 'koerperverletzung', label: 'Körperverletzung' },
  { key: 'robbery', slug: 'raub', label: 'Raub' },
  { key: 'burglary', slug: 'einbruch', label: 'Einbruch' },
  { key: 'arson', slug: 'brandstiftung', label: 'Brandstiftung' },
  { key: 'drugs', slug: 'drogen', label: 'Drogen' },
  { key: 'fraud', slug: 'betrug', label: 'Betrug' },
  { key: 'vandalism', slug: 'sachbeschaedigung', label: 'Sachbeschädigung' },
  { key: 'traffic', slug: 'verkehr', label: 'Verkehr' },
  { key: 'missing_person', slug: 'vermisst', label: 'Vermisst' },
  { key: 'other', slug: 'sonstiges', label: 'Sonstiges' },
];

/** Map from crime category key to slug entry */
export const CRIME_SLUG_MAP: Record<CrimeCategory, CrimeSlugEntry> = Object.fromEntries(
  CRIME_SLUG_ENTRIES.map((e) => [e.key, e])
) as Record<CrimeCategory, CrimeSlugEntry>;

/** Map from URL slug to crime category key */
export const SLUG_TO_CRIME: Record<string, CrimeSlugEntry> = Object.fromEntries(
  CRIME_SLUG_ENTRIES.map((e) => [e.slug, e])
);

/** All crime slugs for generateStaticParams */
export const ALL_CRIME_SLUGS: string[] = CRIME_SLUG_ENTRIES.map((e) => e.slug);
