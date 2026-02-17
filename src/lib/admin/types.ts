// ─── Pipeline Admin Types ───────────────────────────────────

export type MetricKey = 'scraped' | 'enriched' | 'geocoded' | 'junk';

export interface BreakdownRow {
  dimension: string;
  dimension_value: string;
  total: number;
  geocoded: number;
}

export interface MetricBreakdownResponse {
  metric: MetricKey;
  byMonth: BreakdownRow[];
  byPipelineRun: BreakdownRow[];
  byBundesland: BreakdownRow[];
}

export interface ManifestChunk {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  year_month: string;
  start_date: string;
  end_date: string;
  raw_file: string;
  enriched_file: string;
  articles_count: number | null;
  enriched_count: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  retries: number;
}

export interface ManifestData {
  config: {
    start_date: string;
    end_date: string;
    created_at: string;
  };
  statistics: {
    total_chunks: number;
    completed: number;
    in_progress: number;
    failed: number;
    pending: number;
    last_updated?: string;
  };
  chunks: Record<string, ManifestChunk>;
}

export interface PipelineStats {
  totalScraped: number;
  totalEnriched: number;
  totalGeocoded: number;
  totalJunk: number;
  chunksByMonth: Record<string, { raw: number; enriched: number }>;
  bundeslandCounts: Record<string, { raw: number; enriched: number }>;
}

export interface RawArticle {
  title: string;
  date: string;
  city: string | null;
  bundesland: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
  url: string;
  body: string;
}

export interface EnrichedArticle extends RawArticle {
  clean_title?: string;
  classification?: string;
  is_update?: boolean;
  location?: {
    street?: string;
    house_number?: string;
    district?: string;
    city?: string;
    location_hint?: string;
    cross_street?: string;
    confidence?: number;
    lat?: number;
    lon?: number;
    precision?: string;
    bundesland?: string;
  };
  incident_time?: {
    start_date?: string;
    start_time?: string;
    end_date?: string;
    end_time?: string;
    precision?: string;
    /** @deprecated Use start_date instead */
    date?: string;
    /** @deprecated Use start_time instead */
    time?: string;
  };
  crime?: {
    pks_code?: string;
    pks_category?: string;
    sub_type?: string;
    confidence?: number;
  };
  details?: {
    weapon_type?: string;
    drug_type?: string;
    victim_count?: number;
    suspect_count?: number;
    victim_age?: string;
    suspect_age?: string;
    victim_gender?: string;
    suspect_gender?: string;
    victim_herkunft?: string;
    suspect_herkunft?: string;
    victim_description?: string;
    suspect_description?: string;
    severity?: string;
    motive?: string;
    damage_amount_eur?: number | null;
    damage_estimate?: string;
  };
  incident_group_id?: string;
  group_role?: string;
}

export interface ChunksResponse {
  raw: RawArticle[];
  enriched: EnrichedArticle[];
  yearMonth: string;
  bundesland: string | null;
}

export interface PairedArticle {
  raw: RawArticle;
  enriched: EnrichedArticle[];
  cacheEntry: unknown;
}

export interface CompareArticleSummary {
  index: number;
  url: string;
  title: string;
  date: string;
  bundesland: string | null;
  hasEnriched: boolean;
}

export interface CompareChunksMetaResponse {
  yearMonth: string;
  bundesland: string | null;
  dataSource: 'files' | 'database';
  total: number;
  availableSubTypes: string[];
  summaries: CompareArticleSummary[];
}

export interface CompareChunksDetailResponse {
  yearMonth: string;
  bundesland: string | null;
  dataSource: 'files' | 'database';
  total: number;
  index: number;
  article: PairedArticle | null;
}

export interface AvailableMonthsResponse {
  months: string[];
  oldest: string | null;
}

export interface AdminComment {
  id: string;
  created_at: string;
  article_url: string;
  cache_key?: string;
  field_path: string;
  comment_text: string;
  suggested_fix?: string;
  status: 'open' | 'resolved' | 'wontfix';
}

export interface TokenUsageEntry {
  id?: string;
  created_at?: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  batch_size?: number;
  chunk_id?: string;
  pipeline_run?: string;
  latency_ms?: number;
  cost_usd?: number;
  stage?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  stage: 'scrape' | 'filter' | 'enrich' | 'geocode' | 'push';
  message: string;
}

export interface EnrichFile {
  bundesland: string;
  filename: string;
  path: string;
  absolutePath: string;
  articleCount: number;
  dateRange: { earliest: string | null; latest: string | null };
  sizeBytes: number;
}

export interface EnrichEstimate {
  totalArticles: number;
  numBatches: number;
  estimatedCostUsd: number;
  estimatedTimeSeconds: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
}

export interface EnrichmentVersion {
  id: string;
  created_at: string;
  article_url: string;
  prompt_version: string;
  model: string;
  enriched_data: EnrichedArticle[];
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
}

export interface ScrapeMonthRow {
  bundesland: string;
  yearMonth: string;
  filename: string;
  filePath: string;
  articleCount: number;
  presseportalCount: number | null;
  sizeBytes: number;
  modifiedAt: string;
}

export interface ScrapeHistory {
  rows: ScrapeMonthRow[];
  byDay: Record<string, number>;
  byBundesland: Record<string, Record<string, number>>;
}

export interface EnrichHistoryFile {
  bundesland: string;
  yearMonth: string;
  filename: string;
  path: string;
  articleCount: number;
  rawArticleCount: number | null;
  dateRange: { start: string | null; end: string | null };
  sizeBytes: number;
  createdAt: string;
}

export interface EnrichHistory {
  files: EnrichHistoryFile[];
  byDay: Record<string, number>;
  byBundesland: Record<string, Record<string, number>>;
}

export interface GeocodeHistoryFile {
  bundesland: string;
  yearMonth: string;
  filename: string;
  path: string;
  articleCount: number;
  geocodedCount: number;
  dateRange: { start: string | null; end: string | null };
  sizeBytes: number;
  createdAt: string;
}

export interface GeocodePoint {
  lat: number;
  lon: number;
  bundesland: string;
}

export interface GeocodeHistory {
  files: GeocodeHistoryFile[];
  byDay: Record<string, number>;
  byBundesland: Record<string, Record<string, number>>;
  pointsByDay: Record<string, GeocodePoint[]>;
}

export const BUNDESLAENDER = [
  'baden-wuerttemberg', 'bayern', 'berlin', 'brandenburg',
  'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern',
  'niedersachsen', 'nordrhein-westfalen', 'rheinland-pfalz',
  'saarland', 'sachsen', 'sachsen-anhalt', 'schleswig-holstein',
  'thueringen',
] as const;

export const BUNDESLAND_LABELS: Record<string, string> = {
  'baden-wuerttemberg': 'Baden-Württemberg',
  'bayern': 'Bayern',
  'berlin': 'Berlin',
  'brandenburg': 'Brandenburg',
  'bremen': 'Bremen',
  'hamburg': 'Hamburg',
  'hessen': 'Hessen',
  'mecklenburg-vorpommern': 'Mecklenburg-Vorpommern',
  'niedersachsen': 'Niedersachsen',
  'nordrhein-westfalen': 'Nordrhein-Westfalen',
  'rheinland-pfalz': 'Rheinland-Pfalz',
  'saarland': 'Saarland',
  'sachsen': 'Sachsen',
  'sachsen-anhalt': 'Sachsen-Anhalt',
  'schleswig-holstein': 'Schleswig-Holstein',
  'thueringen': 'Thüringen',
};

const BUNDESLAND_SLUG_ALIASES: Record<string, string> = {
  'baden-wurttemberg': 'baden-wuerttemberg',
  'badenwurttemberg': 'baden-wuerttemberg',
  'badenwuerttemberg': 'baden-wuerttemberg',
  'thuringen': 'thueringen',
  'thueringen': 'thueringen',
  'nordrheinwestfalen': 'nordrhein-westfalen',
  'rheinlandpfalz': 'rheinland-pfalz',
  'schleswigholstein': 'schleswig-holstein',
  'mecklenburgvorpommern': 'mecklenburg-vorpommern',
};

function normalizeBundeslandSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-');

  const alias = BUNDESLAND_SLUG_ALIASES[normalized];
  if (alias) return alias;

  const compact = normalized.replace(/-/g, '');
  const compactAlias = BUNDESLAND_SLUG_ALIASES[compact];
  if (compactAlias) return compactAlias;

  return normalized;
}

/**
 * Display label for bundesland slugs.
 * Prefers explicit labels and falls back to a prettified, umlaut-aware version.
 */
export function getBundeslandLabel(slug: string): string {
  const normalized = normalizeBundeslandSlug(slug);
  const known = BUNDESLAND_LABELS[normalized];
  if (known) return known;
  if (normalized === 'unknown') return 'Unbekannt';

  return normalized
    .split('-')
    .map((part) => {
      const umlauted = part
        .replace(/ae/g, 'ä')
        .replace(/oe/g, 'ö')
        .replace(/ue/g, 'ü');
      return umlauted.charAt(0).toUpperCase() + umlauted.slice(1);
    })
    .join('-');
}
