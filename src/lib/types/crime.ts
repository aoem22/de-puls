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
  | 'knife'
  | 'gun'
  | 'blunt'
  | 'explosive'
  | 'vehicle'
  | 'none'
  | 'unknown'
  | 'other'
  | null;

export const WEAPON_LABELS: Record<string, { de: string; en: string; icon: string }> = {
  knife:     { de: 'Messer',        en: 'Knife',      icon: '\u{1F52A}' },
  gun:       { de: 'Schusswaffe',   en: 'Firearm',    icon: '\u{1F52B}' },
  blunt:     { de: 'Schlagwaffe',   en: 'Blunt weapon', icon: '\u{1F528}' },
  explosive: { de: 'Sprengstoff',   en: 'Explosive',  icon: '\u{1F4A3}' },
  vehicle:   { de: 'Fahrzeug',      en: 'Vehicle',    icon: '\u{1F697}' },
};

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
