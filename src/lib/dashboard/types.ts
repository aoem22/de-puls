import type { CrimeCategory } from '@/lib/types/crime';

export type DashboardTimeframe =
  | 'today'
  | 'yesterday'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'year_to_date';

export interface DashboardContextValue {
  value: string;
  helper: string;
}

export interface DashboardContextStats {
  peakTime: DashboardContextValue | null;
  suspectProfile: DashboardContextValue | null;
  victimProfile: DashboardContextValue | null;
  topWeapon: DashboardContextValue | null;
  topMotive: DashboardContextValue | null;
  avgDamage: DashboardContextValue | null;
  topDrug: DashboardContextValue | null;
}

export interface DashboardLiveFeedItem {
  id: string;
  title: string;
  clean_title: string | null;
  published_at: string;
  location_text: string | null;
  city: string | null;
  bundesland: string | null;
  categories: CrimeCategory[];
  severity: string | null;
  confidence: number | null;
  body: string | null;
  weapon_type: string | null;
  drug_type: string | null;
  motive: string | null;
  victim_count: number | null;
  suspect_count: number | null;
  victim_age: string | null;
  suspect_age: string | null;
  victim_gender: string | null;
  suspect_gender: string | null;
  victim_herkunft: string | null;
  suspect_herkunft: string | null;
  damage_amount_eur: number | null;
  incident_date: string | null;
  incident_time: string | null;
  pks_category: string | null;
  source_url: string;
}

export interface SecurityOverviewResponse {
  generatedAt: string;
  dataSource: string;
  focusCategory: CrimeCategory | null;
  period: {
    timeframe: DashboardTimeframe;
    label: string;
    previousLabel: string;
    startIso: string;
    endIso: string;
    previousStartIso: string;
    previousEndIso: string;
    scopeYear: number;
  };
  snapshot: {
    incidentsCurrent: number;
    incidentsPrevious: number;
    severeCurrent: number;
    severePrevious: number;
    focusCountCurrent: number;
    newLastHour: number;
    geocodedCurrent: number;
    geocodedRateCurrent: number;
    incidentsTrendPct: number;
    severeTrendPct: number;
    totalRecords2026: number;
  };
  categoryCounts: Array<{ key: CrimeCategory; label: string; count: number }>;
  weaponCounts: Record<string, number>;
  weaponFilter: string | null;
  drugCounts: Record<string, number>;
  drugFilter: string | null;
  topCities: Array<{ city: string; count: number; previousCount: number; rankChange: number | null }>;
  topCityPoints: Array<{ city: string; lat: number; lon: number }>;
  topKreise: Array<{ kreisAgs: string; kreisName: string; count: number; previousCount: number; rankChange: number | null }>;
  topKreisPoints: Array<{ kreis_ags: string; lat: number; lon: number }>;
  anomalies: Array<{ city: string; current: number; previous: number; delta: number }>;
  contextStats: DashboardContextStats;
  liveFeedTotal: number;
  liveFeedPage: number;
  liveFeedPageSize: number;
  liveFeed: DashboardLiveFeedItem[];
}
