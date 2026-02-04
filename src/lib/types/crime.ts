export type CrimeCategory =
  | 'knife'
  | 'burglary'
  | 'robbery'
  | 'arson'
  | 'assault'
  | 'fraud'
  | 'traffic'
  | 'missing_person'
  | 'other';

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
  { key: 'knife', label: 'Messer', color: '#ef4444' },
  { key: 'burglary', label: 'Einbruch', color: '#f97316' },
  { key: 'robbery', label: 'Raub', color: '#f59e0b' },
  { key: 'arson', label: 'Brand', color: '#e11d48' },
  { key: 'assault', label: 'Körperverletzung', color: '#8b5cf6' },
  { key: 'fraud', label: 'Betrug', color: '#14b8a6' },
  { key: 'traffic', label: 'Verkehr', color: '#38bdf8' },
  { key: 'missing_person', label: 'Vermisst', color: '#10b981' },
  { key: 'other', label: 'Sonstiges', color: '#94a3b8' },
];
