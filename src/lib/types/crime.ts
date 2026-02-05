export type CrimeCategory =
  | 'murder'
  | 'knife'
  | 'weapons'
  | 'sexual'
  | 'assault'
  | 'robbery'
  | 'burglary'
  | 'arson'
  | 'drugs'
  | 'fraud'
  | 'vandalism'
  | 'traffic'
  | 'missing_person'
  | 'other';

export type WeaponType =
  | 'messer'
  | 'schusswaffe'
  | 'machete'
  | 'axt'
  | 'schlagwaffe'
  | 'reizgas'
  | 'other'
  | null;

export type LocationPrecision = 'street' | 'neighborhood' | 'city' | 'region' | 'unknown';

export interface CrimeRecord {
  id: string;
  title: string;
  summary?: string | null;
  body?: string | null; // Full press release text
  publishedAt: string;
  sourceUrl: string;
  sourceAgency?: string | null;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  precision: LocationPrecision;
  categories: CrimeCategory[];
  weaponType?: WeaponType;
  confidence: number;
}

export interface CrimeDataset {
  generatedAt: string;
  source: 'presseportal';
  range: {
    start: string;
    end: string;
  };
  records: CrimeRecord[];
}

export const CRIME_CATEGORIES: Array<{
  key: CrimeCategory;
  label: string;
  color: string;
}> = [
  { key: 'murder', label: 'Tötungsdelikt', color: '#7f1d1d' },      // dark red
  { key: 'knife', label: 'Messerangriff', color: '#ef4444' },       // red
  { key: 'weapons', label: 'Waffen', color: '#dc2626' },            // red-600
  { key: 'sexual', label: 'Sexualdelikte', color: '#a855f7' },      // purple
  { key: 'assault', label: 'Körperverletzung', color: '#8b5cf6' },  // violet
  { key: 'robbery', label: 'Raub', color: '#f59e0b' },              // amber
  { key: 'burglary', label: 'Einbruch', color: '#f97316' },         // orange
  { key: 'arson', label: 'Brandstiftung', color: '#e11d48' },       // rose
  { key: 'drugs', label: 'Drogen', color: '#22c55e' },              // green
  { key: 'fraud', label: 'Betrug', color: '#14b8a6' },              // teal
  { key: 'vandalism', label: 'Sachbeschädigung', color: '#64748b' },// slate
  { key: 'traffic', label: 'Verkehr', color: '#38bdf8' },           // sky
  { key: 'missing_person', label: 'Vermisst', color: '#10b981' },   // emerald
  { key: 'other', label: 'Sonstiges', color: '#94a3b8' },           // gray
];
