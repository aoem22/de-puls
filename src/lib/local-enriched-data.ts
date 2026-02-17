/**
 * @deprecated Use `@/lib/supabase/dashboard-queries` instead.
 *
 * Server-side loader for local enriched JSON files.
 * Kept as fallback during the Supabase migration. Will be removed in a follow-up PR.
 *
 * Reads all data/pipeline/chunks/enriched/<state>/2026/*.json files,
 * transforms each article to the dashboard-compatible format (porting
 * logic from scripts/pipeline/push_to_supabase.py), and caches the
 * result in a module-level variable.
 */
import fs from 'fs';
import path from 'path';
import type { CrimeCategory } from '@/lib/types/crime';
import { findKreis } from '@/lib/geo-utils';

// ────────────────────────── Category mappings ──────────────────────────

const PKS_TO_CATEGORY: Record<string, CrimeCategory> = {
  // Violence
  '0100': 'murder',
  '0200': 'murder',
  '0300': 'murder',   // Fahrlässige Tötung
  '2110': 'murder',
  '2100': 'robbery',
  '2200': 'assault',
  '2300': 'assault',  // Straftaten gg. persönliche Freiheit
  '2320': 'assault',  // Nötigung
  '2330': 'assault',  // Freiheitsberaubung
  '2340': 'assault',
  '2400': 'assault',  // Beleidigung
  // Sexual
  '1100': 'sexual',
  '1110': 'sexual',
  '1300': 'sexual',
  '1310': 'sexual',   // Exhibitionismus
  '1320': 'sexual',   // Sexuelle Belästigung
  // Theft / Burglary
  '3000': 'burglary',
  '3100': 'burglary', // Einfacher Diebstahl
  '4000': 'burglary',
  '4100': 'burglary', // Gewerbsmäßiger Diebstahl
  '4350': 'burglary',
  '4780': 'burglary',
  // Fraud
  '5100': 'fraud',
  '5200': 'fraud',    // Computerbetrug
  // Property / Arson
  '6740': 'arson',
  '6750': 'vandalism',
  // Resistance / assault on officers / trespassing
  '6200': 'assault',
  '6210': 'assault',  // Widerstand gegen Vollstreckungsbeamte
  '6220': 'burglary', // Hausfriedensbruch
  '6230': 'assault',  // Landfriedensbruch
  '6260': 'assault',  // Volksverhetzung
  // Traffic
  '7100': 'traffic',
  '7200': 'traffic',
  '7300': 'traffic',
  '7400': 'traffic',
  // Drugs
  '8910': 'drugs',
  // Weapons
  '8900': 'weapons',  // Verstöße gegen das Waffengesetz
  // Immigration / environmental / misc
  '8920': 'other',    // Verstöße gegen das Aufenthaltsgesetz
  '8990': 'other',
};

const GERMAN_TO_CATEGORY: Record<string, CrimeCategory> = {
  // Murder / manslaughter
  'Mord': 'murder',
  'Totschlag': 'murder',
  'Tötungsdelikt': 'murder',
  'Fahrlässige Tötung': 'murder',
  // Robbery
  'Raub': 'robbery',
  'Raub/räuberische Erpressung': 'robbery',
  'Räuberische Erpressung': 'robbery',
  // Assault / threats / coercion
  'Körperverletzung': 'assault',
  'Gefährliche Körperverletzung': 'assault',
  'Schwere Körperverletzung': 'assault',
  'Bedrohung': 'assault',
  'Nötigung': 'assault',
  'Freiheitsberaubung': 'assault',
  'Widerstand gegen Vollstreckungsbeamte': 'assault',
  'Beleidigung': 'assault',
  'Volksverhetzung': 'assault',
  'Landfriedensbruch': 'assault',
  // Sexual offenses
  'Sexualdelikt': 'sexual',
  'Vergewaltigung': 'sexual',
  'Sexuelle Belästigung': 'sexual',
  'Exhibitionismus': 'sexual',
  // Theft / burglary
  'Diebstahl': 'burglary',
  'Einfacher Diebstahl': 'burglary',
  'Schwerer Diebstahl': 'burglary',
  'Wohnungseinbruch': 'burglary',
  'Wohnungseinbruchdiebstahl': 'burglary',
  'Kfz-Diebstahl': 'burglary',
  'Taschendiebstahl': 'burglary',
  'Ladendiebstahl': 'burglary',
  'Hausfriedensbruch': 'burglary',
  // Fraud
  'Betrug': 'fraud',
  'Computerbetrug': 'fraud',
  'Urkundenfälschung': 'fraud',
  // Arson / property damage
  'Brandstiftung': 'arson',
  'Sachbeschädigung': 'vandalism',
  // Traffic
  'Verkehrsunfall': 'traffic',
  'Fahrerflucht': 'traffic',
  'Unfallflucht': 'traffic',
  'Unfallflucht/Fahrerflucht': 'traffic',
  'Trunkenheit': 'traffic',
  'Trunkenheit im Verkehr': 'traffic',
  'Verkehrskontrolle': 'traffic',
  'Fahren ohne Fahrerlaubnis': 'traffic',
  // Drugs
  'Drogen': 'drugs',
  'Verstoß gegen das Betäubungsmittelgesetz': 'drugs',
  // Weapons
  'Verstoß gegen das Waffengesetz': 'weapons',
  'Verstöße gegen das Waffengesetz': 'weapons',
  // Other
  'Vermisst': 'missing_person',
  'Versammlung': 'other',
  'Verstöße gegen das Aufenthaltsgesetz': 'other',
  'Sonstige': 'other',
};

// ────────────────────────── Transform helpers ──────────────────────────

function mapCategory(
  crime: Record<string, unknown>,
  weaponType: string | null,
): CrimeCategory[] {
  const pksCode = (crime.pks_code as string) ?? '';
  const pksCategory = (crime.pks_category as string) ?? '';

  const base = PKS_TO_CATEGORY[pksCode]
    ?? GERMAN_TO_CATEGORY[pksCategory]
    ?? 'other';

  const cats: CrimeCategory[] = [base];

  // Add weapon-derived categories alongside the crime-type category
  if (weaponType === 'knife') {
    if (!cats.includes('knife')) cats.push('knife');
  } else if (weaponType === 'gun') {
    if (!cats.includes('weapons')) cats.push('weapons');
  }

  return cats;
}

function buildLocationText(article: RawArticle): string | null {
  const loc = article.location ?? {};
  const parts: string[] = [];
  if (loc.street) {
    let s = loc.street;
    if (loc.house_number) s += ` ${loc.house_number}`;
    parts.push(s);
  }
  if (loc.district) parts.push(loc.district);
  if (loc.city) parts.push(loc.city);
  return parts.length > 0 ? parts.join(', ') : null;
}

function sanitizeTimestamp(ts: string | undefined | null): string {
  if (!ts) return '2026-01-01T00:00:00';
  let cleaned = ts;
  if (cleaned.includes('unknown')) {
    cleaned = cleaned.replace('Tunknown:00', 'T00:00:00');
  }
  if (!cleaned.includes('T')) {
    cleaned += 'T00:00:00';
  }
  return cleaned;
}

const EMPTY_DRUG_VALUES = new Set([
  '',
  'none',
  'unknown',
  'null',
  'n/a',
  'na',
  'kein',
  'keine',
]);

const CANNABIS_MARKERS = ['cannabis', 'marihuana', 'marijuana', 'thc', 'haschisch', 'hasch', 'hash'];
const COCAINE_MARKERS = ['cocaine', 'kokain', 'crack'];
const AMPHETAMINE_MARKERS = ['amphetamine', 'amphetamin', 'speed'];
const HEROIN_MARKERS = ['heroin'];
const ECSTASY_MARKERS = ['ecstasy', 'mdma', 'xtc'];
const METH_MARKERS = ['crystal meth', 'methamphetamine', 'methamphetamin'];
const OTHER_MARKERS = ['other', 'sonstige', 'misc', 'mixed', 'multiple', 'lsd', 'opium', 'opioid', 'opiat'];
const METH_WORD_PATTERN = /(^|[^a-z])meth([^a-z]|$)/;

function containsAny(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

function containsMethType(value: string): boolean {
  return containsAny(value, METH_MARKERS) || METH_WORD_PATTERN.test(value);
}

function extractDrugTypes(rawDrugType: string | null): string[] {
  if (!rawDrugType) return [];

  const normalized = rawDrugType
    .toLowerCase()
    .replace(/\b(and|und)\b/g, ',')
    .replace(/[|;/+]/g, ',')
    .replace(/_/g, ' ');

  const fragments = normalized
    .split(',')
    .map((part) => part.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0 && !EMPTY_DRUG_VALUES.has(part));

  const drugTypes = new Set<string>();
  for (const fragment of fragments) {
    let matched = false;

    if (containsAny(fragment, CANNABIS_MARKERS)) {
      drugTypes.add('cannabis');
      matched = true;
    }
    if (containsAny(fragment, COCAINE_MARKERS)) {
      drugTypes.add('cocaine');
      matched = true;
    }
    if (containsAny(fragment, AMPHETAMINE_MARKERS)) {
      drugTypes.add('amphetamine');
      matched = true;
    }
    if (containsAny(fragment, HEROIN_MARKERS)) {
      drugTypes.add('heroin');
      matched = true;
    }
    if (containsAny(fragment, ECSTASY_MARKERS)) {
      drugTypes.add('ecstasy');
      matched = true;
    }
    if (containsMethType(fragment)) {
      drugTypes.add('meth');
      matched = true;
    }
    if (containsAny(fragment, OTHER_MARKERS)) {
      drugTypes.add('other');
      matched = true;
    }

    if (!matched) {
      drugTypes.add('other');
    }
  }

  return Array.from(drugTypes);
}

function hasSelectedDrugType(rawDrugType: string | null, selectedDrugTypes: Set<string>): boolean {
  if (selectedDrugTypes.size === 0) return false;
  const drugTypes = extractDrugTypes(rawDrugType);
  for (const drugType of drugTypes) {
    if (selectedDrugTypes.has(drugType)) return true;
  }
  return false;
}

function filterRecordsByDrugType(records: DashboardRecord[], drugType: string | null): DashboardRecord[] {
  if (!drugType) return records;
  const selectedDrugTypes = new Set(extractDrugTypes(drugType));
  if (selectedDrugTypes.size === 0) return [];
  return records.filter((record) => hasSelectedDrugType(record.drug_type, selectedDrugTypes));
}

// ────────────────────────── Types ──────────────────────────

interface RawLocation {
  street?: string | null;
  house_number?: string | null;
  district?: string | null;
  city?: string | null;
  confidence?: number;
  lat?: number | null;
  lon?: number | null;
  precision?: string;
  bundesland?: string;
}

interface RawArticle {
  title?: string;
  clean_title?: string;
  date?: string;
  url?: string;
  body?: string;
  source?: string;
  classification?: string | null;
  location?: RawLocation;
  crime?: Record<string, unknown> | Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
  incident_time?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DashboardRecord {
  id: string;
  title: string;
  clean_title: string | null;
  published_at: string;
  source_url: string;
  location_text: string | null;
  city: string | null;
  bundesland: string | null;
  latitude: number | null;
  longitude: number | null;
  kreis_ags: string | null;
  kreis_name: string | null;
  categories: CrimeCategory[];
  severity: string | null;
  confidence: number;
  // Detail fields for live feed
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
}

// ────────────────────────── Classification filter ──────────────────────────

const INCLUDE_CLASSIFICATIONS = new Set(['crime', 'update']);

function shouldInclude(article: RawArticle): boolean {
  const cls = article.classification;
  // Include crime, update, and null/undefined (no classification)
  if (cls === null || cls === undefined) return true;
  return INCLUDE_CLASSIFICATIONS.has(cls);
}

// ────────────────────────── Transform ──────────────────────────

function transformArticle(article: RawArticle): DashboardRecord | null {
  if (!shouldInclude(article)) return null;

  const loc = article.location ?? {};
  let crime = article.crime ?? {};
  if (Array.isArray(crime)) {
    crime = crime[0] ?? {};
  }
  const details = article.details ?? {};

  const publishedAt = sanitizeTimestamp(article.date);
  const locationText = buildLocationText(article);
  const city = typeof loc.city === 'string' && loc.city.trim() ? loc.city.trim() : null;
  const bundesland = (typeof loc.bundesland === 'string' && loc.bundesland.trim())
    ? loc.bundesland.trim()
    : (typeof article.bundesland === 'string' ? (article.bundesland as string).trim() : null);

  const validSeverities = new Set(['minor', 'serious', 'critical', 'fatal', 'property_only', 'unknown']);
  const severity = typeof details.severity === 'string' && validSeverities.has(details.severity)
    ? details.severity
    : null;

  const cleanTitle = typeof article.clean_title === 'string' && article.clean_title.trim()
    ? article.clean_title
    : null;

  // Extract weapon_type for category augmentation
  const rawWeapon = details.weapon_type;
  const weaponType = typeof rawWeapon === 'string' && rawWeapon !== 'none'
    ? rawWeapon.split(',')[0].split(' ')[0].trim()
    : null;

  // Extract detail fields
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() && v !== 'unknown' && v !== 'none' ? v.trim() : null;
  const intOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

  // Incident time
  const incidentTimeObj = article.incident_time ?? {};
  const incidentDate = strOrNull(
    (incidentTimeObj as Record<string, unknown>).start_date ?? (incidentTimeObj as Record<string, unknown>).date,
  );
  const incidentTime = strOrNull(
    (incidentTimeObj as Record<string, unknown>).start_time ?? (incidentTimeObj as Record<string, unknown>).time,
  );

  // Assign Kreis via point-in-polygon
  const lat = loc.lat ?? null;
  const lon = loc.lon ?? null;
  const kreisMatch = lat != null && lon != null ? findKreis(lon, lat) : null;

  return {
    id: `${article.url ?? ''}:${publishedAt}:${locationText ?? ''}`,
    title: article.title ?? '',
    clean_title: cleanTitle,
    published_at: publishedAt,
    source_url: article.url ?? '',
    location_text: locationText,
    city,
    bundesland,
    latitude: lat,
    longitude: lon,
    kreis_ags: kreisMatch?.ags ?? null,
    kreis_name: kreisMatch?.name ?? null,
    categories: mapCategory(crime, weaponType),
    severity,
    confidence: loc.confidence ?? 0.5,
    body: typeof article.body === 'string' ? article.body : null,
    weapon_type: weaponType,
    drug_type: strOrNull(details.drug_type),
    motive: strOrNull(details.motive),
    victim_count: intOrNull(details.victim_count),
    suspect_count: intOrNull(details.suspect_count),
    victim_age: strOrNull(details.victim_age),
    suspect_age: strOrNull(details.suspect_age),
    victim_gender: strOrNull(details.victim_gender),
    suspect_gender: strOrNull(details.suspect_gender),
    victim_herkunft: strOrNull(details.victim_herkunft),
    suspect_herkunft: strOrNull(details.suspect_herkunft),
    damage_amount_eur: intOrNull(details.damage_amount_eur),
    incident_date: incidentDate,
    incident_time: incidentTime,
    pks_category: strOrNull(crime.pks_category as string),
  };
}

// ────────────────────────── Data loading & caching ──────────────────────────

let cachedRecords: DashboardRecord[] | null = null;

function loadAllRecords(): DashboardRecord[] {
  if (cachedRecords) return cachedRecords;

  const baseDir = path.join(process.cwd(), 'data', 'pipeline', 'chunks', 'enriched');
  const records: DashboardRecord[] = [];

  // Read all <state>/2026/*.json
  let stateDirs: string[];
  try {
    stateDirs = fs.readdirSync(baseDir);
  } catch {
    console.warn('[local-enriched-data] Cannot read enriched dir:', baseDir);
    cachedRecords = [];
    return [];
  }

  for (const state of stateDirs) {
    const yearDir = path.join(baseDir, state, '2026');
    let files: string[];
    try {
      files = fs.readdirSync(yearDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue; // No 2026 directory for this state
    }

    for (const file of files) {
      const filePath = path.join(yearDir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RawArticle[];
        for (const article of raw) {
          const record = transformArticle(article);
          if (record) records.push(record);
        }
      } catch (err) {
        console.warn(`[local-enriched-data] Failed to parse ${filePath}:`, err);
      }
    }
  }

  // Sort by published_at descending
  records.sort((a, b) => (b.published_at > a.published_at ? 1 : b.published_at < a.published_at ? -1 : 0));

  console.log(`[local-enriched-data] Loaded ${records.length} records from ${baseDir}`);
  cachedRecords = records;
  return records;
}

// ────────────────────────── Query functions ──────────────────────────

export interface CountOptions {
  startIso?: string;
  endIso?: string;
  category?: CrimeCategory | null;
  overlapCategories?: CrimeCategory[];
  geocodedOnly?: boolean;
  weaponType?: string | null;
  drugType?: string | null;
}

export function countRecords(opts: CountOptions): number {
  let records = loadAllRecords();

  if (opts.startIso) {
    records = records.filter((r) => r.published_at >= opts.startIso!);
  }
  if (opts.endIso) {
    records = records.filter((r) => r.published_at < opts.endIso!);
  }
  if (opts.category) {
    const cat = opts.category;
    records = records.filter((r) => r.categories.includes(cat));
  }
  if (opts.overlapCategories && opts.overlapCategories.length > 0) {
    const cats = opts.overlapCategories;
    records = records.filter((r) => r.categories.some((c) => cats.includes(c)));
  }
  if (opts.geocodedOnly) {
    records = records.filter((r) => r.latitude != null && r.longitude != null);
  }
  if (opts.weaponType) {
    const wt = opts.weaponType;
    records = records.filter((r) => r.weapon_type === wt);
  }
  records = filterRecordsByDrugType(records, opts.drugType ?? null);

  return records.length;
}

export function getCityRows(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
): Array<{ city: string; published_at: string }> {
  let records = loadAllRecords();

  records = records.filter(
    (r) => r.published_at >= startIso && r.published_at < endIso && r.city != null,
  );

  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  return records.map((r) => ({ city: r.city!, published_at: r.published_at }));
}

export function getKreisRows(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
): Array<{ kreis_ags: string; kreis_name: string; published_at: string }> {
  let records = loadAllRecords();

  records = records.filter(
    (r) => r.published_at >= startIso && r.published_at < endIso && r.kreis_ags != null,
  );

  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  return records.map((r) => ({
    kreis_ags: r.kreis_ags!,
    kreis_name: r.kreis_name!,
    published_at: r.published_at,
  }));
}

export function getGeocodedKreisPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  kreisSet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
): Array<{ kreis_ags: string; lat: number; lon: number }> {
  let records = loadAllRecords();

  records = records.filter(
    (r) =>
      r.published_at >= startIso &&
      r.published_at < endIso &&
      r.latitude != null &&
      r.longitude != null &&
      r.kreis_ags != null &&
      kreisSet.has(r.kreis_ags!),
  );

  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  const seen = new Set<string>();
  const points: Array<{ kreis_ags: string; lat: number; lon: number }> = [];

  for (const r of records) {
    const key = `${r.kreis_ags}:${r.latitude!.toFixed(2)}:${r.longitude!.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ kreis_ags: r.kreis_ags!, lat: r.latitude!, lon: r.longitude! });
  }

  return points;
}

export type LiveFeedItem = Pick<DashboardRecord,
  | 'id' | 'title' | 'clean_title' | 'published_at' | 'location_text' | 'city'
  | 'bundesland' | 'categories' | 'severity' | 'confidence' | 'body'
  | 'weapon_type' | 'drug_type' | 'motive' | 'victim_count' | 'suspect_count'
  | 'victim_age' | 'suspect_age' | 'victim_gender' | 'suspect_gender'
  | 'victim_herkunft' | 'suspect_herkunft' | 'damage_amount_eur'
  | 'incident_date' | 'incident_time' | 'pks_category' | 'source_url'
>;

export function getLiveFeed(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  limit: number,
  offset = 0,
  weaponType: string | null = null,
  drugType: string | null = null,
): { items: LiveFeedItem[]; total: number } {
  let records = loadAllRecords();

  records = records.filter((r) => r.published_at >= startIso && r.published_at < endIso);

  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  const total = records.length;

  // Already sorted descending by published_at
  const items = records.slice(offset, offset + limit).map((r) => ({
    id: r.id,
    title: r.title,
    clean_title: r.clean_title,
    published_at: r.published_at,
    location_text: r.location_text,
    city: r.city,
    bundesland: r.bundesland,
    categories: r.categories,
    severity: r.severity,
    confidence: r.confidence,
    body: r.body,
    weapon_type: r.weapon_type,
    drug_type: r.drug_type,
    motive: r.motive,
    victim_count: r.victim_count,
    suspect_count: r.suspect_count,
    victim_age: r.victim_age,
    suspect_age: r.suspect_age,
    victim_gender: r.victim_gender,
    suspect_gender: r.suspect_gender,
    victim_herkunft: r.victim_herkunft,
    suspect_herkunft: r.suspect_herkunft,
    damage_amount_eur: r.damage_amount_eur,
    incident_date: r.incident_date,
    incident_time: r.incident_time,
    pks_category: r.pks_category,
    source_url: r.source_url,
  }));

  return { items, total };
}

export function getGeocodedCityPoints(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  citySet: Set<string>,
  weaponType: string | null = null,
  drugType: string | null = null,
): Array<{ city: string; lat: number; lon: number }> {
  let records = loadAllRecords();

  records = records.filter(
    (r) =>
      r.published_at >= startIso &&
      r.published_at < endIso &&
      r.latitude != null &&
      r.longitude != null &&
      r.city != null &&
      citySet.has(r.city!),
  );

  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  // Deduplicate by rounding to 2 decimal places (~1km precision)
  const seen = new Set<string>();
  const points: Array<{ city: string; lat: number; lon: number }> = [];

  for (const r of records) {
    const key = `${r.city}:${r.latitude!.toFixed(2)}:${r.longitude!.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ city: r.city!, lat: r.latitude!, lon: r.longitude! });
  }

  return points;
}

// ────────────────────────── Context stats for KPI cards ──────────────────────────

export interface ContextStatMetric {
  value: string;
  helper: string;
}

export interface ContextStats {
  peakTime: ContextStatMetric | null;
  suspectProfile: ContextStatMetric | null;
  victimProfile: ContextStatMetric | null;
  topWeapon: ContextStatMetric | null;
  topMotive: ContextStatMetric | null;
  avgDamage: ContextStatMetric | null;
  topDrug: ContextStatMetric | null;
}

const TIME_BANDS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'] as const;

function parseAges(ageStr: string): number[] {
  // Handles "42", "42, 21", "14-16", "ca. 30"
  const ages: number[] = [];
  for (const part of ageStr.split(/[,;]/)) {
    const rangeMatch = part.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (rangeMatch) {
      ages.push((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
    } else {
      const numMatch = part.match(/(\d+)/);
      if (numMatch) ages.push(parseInt(numMatch[1]));
    }
  }
  return ages.filter((a) => a > 0 && a < 120);
}

function topEntry(counts: Record<string, number>, total: number): { value: string; pct: number } | null {
  let best = '';
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  if (!best || bestCount === 0) return null;
  return { value: best, pct: Math.round((bestCount / total) * 100) };
}

export function getContextStats(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
  weaponType: string | null = null,
  drugType: string | null = null,
): ContextStats {
  let records = loadAllRecords();
  records = records.filter((r) => r.published_at >= startIso && r.published_at < endIso);
  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }
  if (weaponType) {
    records = records.filter((r) => r.weapon_type === weaponType);
  }
  records = filterRecordsByDrugType(records, drugType);

  // ── peakTime ──
  const timeBuckets = [0, 0, 0, 0, 0, 0];
  let timeTotal = 0;
  for (const r of records) {
    if (!r.incident_time) continue;
    const hourMatch = r.incident_time.match(/^(\d{1,2})/);
    if (!hourMatch) continue;
    const hour = parseInt(hourMatch[1]);
    if (hour >= 0 && hour < 24) {
      timeBuckets[Math.floor(hour / 4)]++;
      timeTotal++;
    }
  }
  let peakTime: ContextStatMetric | null = null;
  if (timeTotal > 0) {
    let peakIdx = 0;
    for (let i = 1; i < 6; i++) {
      if (timeBuckets[i] > timeBuckets[peakIdx]) peakIdx = i;
    }
    peakTime = {
      value: `${TIME_BANDS[peakIdx]} Uhr`,
      helper: `${Math.round((timeBuckets[peakIdx] / timeTotal) * 100)}% der Fälle`,
    };
  }

  // ── suspectProfile ──
  const suspectAges: number[] = [];
  const suspectGenders: Record<string, number> = {};
  let suspectGenderTotal = 0;
  for (const r of records) {
    if (r.suspect_age) suspectAges.push(...parseAges(r.suspect_age));
    if (r.suspect_gender) {
      suspectGenders[r.suspect_gender] = (suspectGenders[r.suspect_gender] ?? 0) + 1;
      suspectGenderTotal++;
    }
  }
  let suspectProfile: ContextStatMetric | null = null;
  if (suspectAges.length > 0 || suspectGenderTotal > 0) {
    const avgAge = suspectAges.length > 0
      ? Math.round(suspectAges.reduce((a, b) => a + b, 0) / suspectAges.length)
      : null;
    const genderTop = topEntry(suspectGenders, suspectGenderTotal);
    const genderLabel = genderTop
      ? `${genderTop.pct}% ${genderTop.value === 'male' ? 'männl.' : genderTop.value === 'female' ? 'weibl.' : genderTop.value}`
      : null;
    suspectProfile = {
      value: avgAge != null ? `Ø ${avgAge} J.` : (genderLabel ?? '–'),
      helper: avgAge != null && genderLabel ? genderLabel : `${suspectAges.length + suspectGenderTotal} Angaben`,
    };
  }

  // ── victimProfile ──
  const victimAges: number[] = [];
  const victimGenders: Record<string, number> = {};
  let victimGenderTotal = 0;
  for (const r of records) {
    if (r.victim_age) victimAges.push(...parseAges(r.victim_age));
    if (r.victim_gender) {
      victimGenders[r.victim_gender] = (victimGenders[r.victim_gender] ?? 0) + 1;
      victimGenderTotal++;
    }
  }
  let victimProfile: ContextStatMetric | null = null;
  if (victimAges.length > 0 || victimGenderTotal > 0) {
    const avgAge = victimAges.length > 0
      ? Math.round(victimAges.reduce((a, b) => a + b, 0) / victimAges.length)
      : null;
    const genderTop = topEntry(victimGenders, victimGenderTotal);
    const genderLabel = genderTop
      ? `${genderTop.pct}% ${genderTop.value === 'male' ? 'männl.' : genderTop.value === 'female' ? 'weibl.' : genderTop.value}`
      : null;
    victimProfile = {
      value: avgAge != null ? `Ø ${avgAge} J.` : (genderLabel ?? '–'),
      helper: avgAge != null && genderLabel ? genderLabel : `${victimAges.length + victimGenderTotal} Angaben`,
    };
  }

  // ── topWeapon ──
  const weaponCounts: Record<string, number> = {};
  let weaponTotal = 0;
  for (const r of records) {
    if (r.weapon_type && r.weapon_type !== 'unknown' && r.weapon_type !== 'none' && r.weapon_type !== 'vehicle') {
      weaponCounts[r.weapon_type] = (weaponCounts[r.weapon_type] ?? 0) + 1;
      weaponTotal++;
    }
  }
  const weaponTop = topEntry(weaponCounts, weaponTotal);
  const topWeapon: ContextStatMetric | null = weaponTop
    ? { value: weaponTop.value, helper: `${weaponTop.pct}% der Fälle` }
    : null;

  // ── topMotive ──
  const motiveCounts: Record<string, number> = {};
  let motiveTotal = 0;
  for (const r of records) {
    if (r.motive) {
      motiveCounts[r.motive] = (motiveCounts[r.motive] ?? 0) + 1;
      motiveTotal++;
    }
  }
  const motiveTop = topEntry(motiveCounts, motiveTotal);
  const topMotive: ContextStatMetric | null = motiveTop
    ? { value: motiveTop.value, helper: `${motiveTop.pct}% der Fälle` }
    : null;

  // ── avgDamage ──
  let damageSum = 0;
  let damageCount = 0;
  for (const r of records) {
    if (r.damage_amount_eur != null && r.damage_amount_eur > 0) {
      damageSum += r.damage_amount_eur;
      damageCount++;
    }
  }
  const avgDamage: ContextStatMetric | null = damageCount > 0
    ? {
        value: damageSum / damageCount >= 1000
          ? `${(damageSum / damageCount / 1000).toFixed(1)}k €`
          : `${Math.round(damageSum / damageCount).toLocaleString('de-DE')} €`,
        helper: `${damageCount} Fälle mit Angabe`,
      }
    : null;

  // ── topDrug ──
  const drugCounts: Record<string, number> = {};
  let drugTotal = 0;
  for (const r of records) {
    const drugTypes = extractDrugTypes(r.drug_type);
    for (const drugType of drugTypes) {
      drugCounts[drugType] = (drugCounts[drugType] ?? 0) + 1;
      drugTotal++;
    }
  }
  const drugTop = topEntry(drugCounts, drugTotal);
  const topDrug: ContextStatMetric | null = drugTop
    ? { value: drugTop.value, helper: `${drugTop.pct}% der Fälle` }
    : null;

  return { peakTime, suspectProfile, victimProfile, topWeapon, topMotive, avgDamage, topDrug };
}

export function getWeaponCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
): Record<string, number> {
  let records = loadAllRecords();
  records = records.filter((r) => r.published_at >= startIso && r.published_at < endIso);
  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }

  const counts: Record<string, number> = {};
  for (const r of records) {
    if (r.weapon_type && r.weapon_type !== 'none' && r.weapon_type !== 'unknown' && r.weapon_type !== 'vehicle') {
      counts[r.weapon_type] = (counts[r.weapon_type] ?? 0) + 1;
    }
  }
  return counts;
}

export function getDrugCounts(
  startIso: string,
  endIso: string,
  category: CrimeCategory | null,
): Record<string, number> {
  let records = loadAllRecords();
  records = records.filter((r) => r.published_at >= startIso && r.published_at < endIso);
  if (category) {
    records = records.filter((r) => r.categories.includes(category));
  }

  const counts: Record<string, number> = {};
  for (const r of records) {
    const drugTypes = extractDrugTypes(r.drug_type);
    for (const drugType of drugTypes) {
      counts[drugType] = (counts[drugType] ?? 0) + 1;
    }
  }
  return counts;
}

export function getTotalCount(): number {
  return loadAllRecords().length;
}

export function getLatestPublishedAt(): string | null {
  const records = loadAllRecords();
  return records.length > 0 ? records[0].published_at : null;
}
