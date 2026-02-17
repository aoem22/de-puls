import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { parseChunkFilename } from '@/lib/admin/chunk-utils';
import { mapToCategories } from '@/lib/admin/category-mapping';
import type { CrimeCategory, WeaponType } from '@/lib/types/crime';

const DATA_DIR = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_RAW_DIR = path.join(DATA_DIR, 'chunks', 'raw');
const CHUNKS_ENRICHED_DIR = path.join(DATA_DIR, 'chunks', 'enriched');
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CHUNKS_RESPONSE_CACHE_TTL_MS = 20_000;
const PARSED_FILE_CACHE_LIMIT = 200;

const parsedFileCache = new Map<string, { mtimeMs: number; value: Record<string, unknown>[] }>();
const chunksResponseCache = new Map<string, { expiresAt: number; value: FullChunksPayload }>();
let enrichmentCacheState: { mtimeMs: number; value: Record<string, unknown> } | null = null;

type DataSource = 'files' | 'database';

interface PairedArticlePayload {
  raw: Record<string, unknown>;
  enriched: Record<string, unknown>[];
  cacheEntry: unknown;
}

interface FullChunksPayload {
  yearMonth: string;
  bundesland: string | null;
  dataSource: DataSource;
  total: number;
  articles: PairedArticlePayload[];
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

/** Map bundesland slug → display name for source_agency matching */
const BUNDESLAND_AGENCY_PATTERNS: Record<string, string[]> = {
  'baden-wuerttemberg': ['Baden-Württemberg', 'Aalen', 'Freiburg', 'Heidelberg', 'Heilbronn', 'Karlsruhe', 'Konstanz', 'Ludwigsburg', 'Mannheim', 'Offenburg', 'Pforzheim', 'Ravensburg', 'Reutlingen', 'Stuttgart', 'Tuttlingen', 'Ulm'],
  'bayern': ['Bayern', 'München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Würzburg', 'Bayreuth', 'Ingolstadt', 'Oberbayern', 'Niederbayern', 'Oberpfalz', 'Oberfranken', 'Mittelfranken', 'Unterfranken', 'Schwaben'],
  'berlin': ['Berlin'],
  'brandenburg': ['Brandenburg', 'Potsdam', 'Cottbus', 'Frankfurt (Oder)'],
  'bremen': ['Bremen', 'Bremerhaven'],
  'hamburg': ['Hamburg'],
  'hessen': ['Hessen', 'Südhessen', 'Nordhessen', 'Osthessen', 'Mittelhessen', 'Südosthessen', 'Westhessen', 'Frankfurt', 'Wiesbaden', 'Darmstadt', 'Kassel'],
  'mecklenburg-vorpommern': ['Mecklenburg', 'Vorpommern', 'Rostock', 'Schwerin', 'Neubrandenburg', 'Anklam', 'Stralsund'],
  'niedersachsen': ['Niedersachsen', 'Hannover', 'Braunschweig', 'Oldenburg', 'Osnabrück', 'Lüneburg', 'Göttingen', 'Cloppenburg', 'Emsland', 'Hildesheim', 'Wilhelmshaven', 'Wolfsburg', 'Celle', 'Hameln', 'Stade', 'Nienburg', 'Delmenhorst'],
  'nordrhein-westfalen': ['Nordrhein', 'Westfalen', 'Düsseldorf', 'Köln', 'Dortmund', 'Essen', 'Duisburg', 'Bochum', 'Bielefeld', 'Bonn', 'Münster', 'Aachen', 'Krefeld', 'Mönchengladbach', 'Gelsenkirchen', 'Hagen', 'Märkischer', 'Oberberg', 'Rhein-Erft', 'Rhein-Sieg', 'Hochsauerland', 'Lippe', 'Minden', 'Paderborn', 'Siegen', 'Soest', 'Unna', 'Warendorf', 'Gütersloh', 'Heinsberg', 'Kleve', 'Mettmann', 'Recklinghausen', 'Rhein-Kreis', 'Viersen', 'Wesel', 'Wuppertal'],
  'rheinland-pfalz': ['Rheinland-Pfalz', 'Mainz', 'Koblenz', 'Trier', 'Ludwigshafen', 'Kaiserslautern', 'Westpfalz'],
  'saarland': ['Saarland', 'Saarbrücken', 'Saarlouis'],
  'sachsen': ['Sachsen', 'Dresden', 'Leipzig', 'Chemnitz', 'Zwickau', 'Görlitz'],
  'sachsen-anhalt': ['Sachsen-Anhalt', 'Magdeburg', 'Halle', 'Dessau'],
  'schleswig-holstein': ['Schleswig', 'Holstein', 'Kiel', 'Lübeck', 'Flensburg', 'Neumünster', 'Pinneberg', 'Itzehoe'],
  'thueringen': ['Thüringen', 'Erfurt', 'Jena', 'Gera', 'Nordhausen', 'Suhl', 'Saalfeld', 'Gotha'],
};

function loadArticlesFromFile(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    const cached = parsedFileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const value = (Array.isArray(data) ? data : (data.articles ?? [])) as Record<string, unknown>[];
    parsedFileCache.set(filePath, { mtimeMs: stat.mtimeMs, value });
    if (parsedFileCache.size > PARSED_FILE_CACHE_LIMIT) {
      const oldestKey = parsedFileCache.keys().next().value;
      if (oldestKey) parsedFileCache.delete(oldestKey);
    }

    return value;
  } catch {
    return [];
  }
}

function loadEnrichmentCache(): Record<string, unknown> {
  const cachePath = path.join(CACHE_DIR, 'enrichment_cache.json');
  if (!fs.existsSync(cachePath)) {
    return {};
  }

  try {
    const stat = fs.statSync(cachePath);
    if (enrichmentCacheState && enrichmentCacheState.mtimeMs === stat.mtimeMs) {
      return enrichmentCacheState.value;
    }
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Record<string, unknown>;
    enrichmentCacheState = { mtimeMs: stat.mtimeMs, value: parsed };
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Extract distinct sub_type values scoped to the active mapped category.
 * Categories are no longer returned dynamically — the frontend uses the
 * hardcoded CRIME_CATEGORIES list.
 */
function extractFilterOptions(
  articles: PairedArticlePayload[],
  activeCategory: string | null,
): { subTypes: string[] } {
  const subs = new Set<string>();
  for (const a of articles) {
    for (const e of a.enriched) {
      const crime = e.crime as { pks_code?: string; pks_category?: string; sub_type?: string } | undefined;
      if (crime?.sub_type) {
        // Only include sub-type if no category filter, or the mapped categories include it
        if (!activeCategory) {
          subs.add(crime.sub_type);
        } else {
          const details = e.details as { weapon_type?: string } | undefined;
          const cats = mapToCategories(crime, details?.weapon_type as WeaponType);
          if (cats.includes(activeCategory as CrimeCategory)) {
            subs.add(crime.sub_type);
          }
        }
      }
    }
  }
  return { subTypes: [...subs].sort() };
}

/** Apply category / subType / keyword search filters to a payload (post-cache). */
function applyFilters(
  payload: FullChunksPayload,
  category: string | null,
  subType: string | null,
  search: string | null,
): FullChunksPayload {
  let articles = payload.articles;

  if (category) {
    articles = articles.filter(a =>
      a.enriched.some(e => {
        const crime = e.crime as { pks_code?: string; pks_category?: string } | undefined;
        const details = e.details as { weapon_type?: string } | undefined;
        const cats = mapToCategories(crime, details?.weapon_type as WeaponType);
        return cats.includes(category as CrimeCategory);
      }),
    );
  }

  if (subType) {
    articles = articles.filter(a =>
      a.enriched.some(e => {
        const crime = e.crime as { sub_type?: string } | undefined;
        return crime?.sub_type === subType;
      }),
    );
  }

  if (search) {
    const q = search.toLowerCase();
    articles = articles.filter(a => {
      const title = String(a.raw.title ?? '').toLowerCase();
      const body = String(a.raw.body ?? '').toLowerCase();
      return title.includes(q) || body.includes(q);
    });
  }

  return { ...payload, articles, total: articles.length };
}

function formatChunksResponse(
  payload: FullChunksPayload,
  view: 'meta' | 'detail' | null,
  index: number | null,
  filterOptions?: { subTypes: string[] },
): Record<string, unknown> {
  if (view === 'meta') {
    return {
      yearMonth: payload.yearMonth,
      bundesland: payload.bundesland,
      dataSource: payload.dataSource,
      total: payload.total,
      availableSubTypes: filterOptions?.subTypes ?? [],
      summaries: payload.articles.map((article, articleIndex) => {
        const raw = article.raw;
        return {
          index: articleIndex,
          url: String(raw.url ?? ''),
          title: String(raw.title ?? ''),
          date: String(raw.date ?? ''),
          bundesland: (raw.bundesland as string | null) ?? null,
          hasEnriched: article.enriched.length > 0,
        };
      }),
    };
  }

  if (view === 'detail') {
    const safeIndex = index ?? 0;
    return {
      yearMonth: payload.yearMonth,
      bundesland: payload.bundesland,
      dataSource: payload.dataSource,
      total: payload.total,
      index: safeIndex,
      article: payload.articles[safeIndex] ?? null,
    };
  }

  return payload as unknown as Record<string, unknown>;
}

/**
 * Check if a filename covers a given yearMonth.
 * Matches:
 *   "2026-02.json" for yearMonth "2026-02" (prefix match)
 *   "2024-01-01_2024-12-31.json" for any yearMonth in 2024 (date range match)
 */
function fileMatchesYearMonth(filename: string, yearMonth: string): boolean {
  if (!filename.endsWith('.json')) return false;

  // Strip optional ".chunk_" prefix for matching
  const baseName = filename.replace(/^\.?chunk_/, '');

  // Direct prefix match: "2026-02.json", "2026-02-10_2026-02-11.json"
  if (baseName.startsWith(yearMonth)) return true;

  // Date range match: "2024-01-01_2024-12-31.json"
  const rangeMatch = baseName.match(/^(\d{4}-\d{2})-\d{2}_(\d{4}-\d{2})-\d{2}\.json$/);
  if (rangeMatch) {
    const startYM = rangeMatch[1]; // e.g. "2024-01"
    const endYM = rangeMatch[2];   // e.g. "2024-12"
    return yearMonth >= startYM && yearMonth <= endYM;
  }

  return false;
}

/**
 * Check if an article's date falls within the requested yearMonth.
 * Handles date strings like "2024-06-15", "2024-06-15T10:00:00Z", etc.
 */
function articleMatchesMonth(article: Record<string, unknown>, yearMonth: string): boolean {
  const date = (article.date as string) || (article.published_at as string) || '';
  return date.startsWith(yearMonth);
}

/**
 * Load articles from a flat chunk directory, filtering by yearMonth and optional bundesland.
 * Files use German month naming: {bundesland}_{monat}_{year}.json
 * Also handles legacy date-range filenames for backward compatibility.
 * Can deduplicate by URL to avoid overlap duplicates in raw scrape files.
 */
function loadArticlesFromFlatDir(
  dir: string,
  yearMonth: string,
  bundesland?: string | null,
  dedupeByUrl = true,
): Record<string, unknown>[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const seen = new Set<string>();
    const result: Record<string, unknown>[] = [];

    const processFile = (filePath: string, fileName: string) => {
      const isRangeFile = /^\.?(?:chunk_)?\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json$/.test(fileName);
      const articles = loadArticlesFromFile(filePath);
      for (const art of articles) {
        if (isRangeFile && !articleMatchesMonth(art, yearMonth)) continue;
        const url = art.url as string;
        if (dedupeByUrl && url && seen.has(url)) continue;
        if (dedupeByUrl && url) seen.add(url);
        result.push(art);
      }
    };

    // 1. Flat files in dir (legacy: hessen_januar_2024.json)
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file.endsWith('.meta.json') || file.includes('_enriched')) continue;

      // Try German month filename
      const parsed = parseChunkFilename(file);
      if (parsed) {
        if (parsed.yearMonth !== yearMonth) continue;
        if (bundesland && parsed.bundesland !== bundesland) continue;
        processFile(path.join(dir, file), file);
        continue;
      }

      // Legacy date-range or prefix-match files
      if (fileMatchesYearMonth(file, yearMonth)) {
        processFile(path.join(dir, file), file);
      }
    }

    // 2. Nested: {dir}/{bundesland}/{year}/{MM}.json
    const [targetYear, targetMonth] = yearMonth.split('-');
    for (const bl of fs.readdirSync(dir)) {
      if (bundesland && bl !== bundesland) continue;
      const blPath = path.join(dir, bl);
      try { if (!fs.statSync(blPath).isDirectory()) continue; } catch { continue; }

      for (const yearDir of fs.readdirSync(blPath)) {
        if (yearDir !== targetYear) continue;
        const yearPath = path.join(blPath, yearDir);
        try { if (!fs.statSync(yearPath).isDirectory()) continue; } catch { continue; }

        for (const monthFile of fs.readdirSync(yearPath)) {
          if (!monthFile.endsWith('.json') || monthFile.endsWith('.meta.json') || monthFile.includes('_enriched')) continue;
          const monthNum = monthFile.replace('.json', '').padStart(2, '0');
          if (monthNum !== targetMonth) continue;
          processFile(path.join(yearPath, monthFile), monthFile);
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Load enriched articles from _enriched files in a flat directory.
 * The pipeline writes enriched output alongside raw files with an `_enriched` suffix.
 */
function loadEnrichedFromFlatDir(
  dir: string,
  yearMonth: string,
  bundesland?: string | null,
  dedupeByUrl = false,
): Record<string, unknown>[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const seen = new Set<string>();
    const result: Record<string, unknown>[] = [];

    // 1. Flat _enriched files in dir (legacy)
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || !file.includes('_enriched')) continue;

      // Strip _enriched suffix to parse the base filename
      const baseName = file.replace('_enriched', '');
      const parsed = parseChunkFilename(baseName);
      if (parsed) {
        if (parsed.yearMonth !== yearMonth) continue;
        if (bundesland && parsed.bundesland !== bundesland) continue;
      } else if (!fileMatchesYearMonth(baseName, yearMonth)) {
        continue;
      }

      const articles = loadArticlesFromFile(path.join(dir, file));
      for (const art of articles) {
        const url = art.url as string;
        if (dedupeByUrl && url && seen.has(url)) continue;
        if (dedupeByUrl && url) seen.add(url);
        result.push(art);
      }
    }

    // 2. Nested _enriched: {dir}/{bundesland}/{year}/{MM}_enriched.json
    const [targetYear, targetMonth] = yearMonth.split('-');
    for (const bl of fs.readdirSync(dir)) {
      if (bundesland && bl !== bundesland) continue;
      const blPath = path.join(dir, bl);
      try { if (!fs.statSync(blPath).isDirectory()) continue; } catch { continue; }

      for (const yearDir of fs.readdirSync(blPath)) {
        if (yearDir !== targetYear) continue;
        const yearPath = path.join(blPath, yearDir);
        try { if (!fs.statSync(yearPath).isDirectory()) continue; } catch { continue; }

        for (const monthFile of fs.readdirSync(yearPath)) {
          if (!monthFile.endsWith('.json') || !monthFile.includes('_enriched')) continue;
          const baseName = monthFile.replace('_enriched', '');
          const monthNum = baseName.replace('.json', '').padStart(2, '0');
          if (monthNum !== targetMonth) continue;

          const articles = loadArticlesFromFile(path.join(yearPath, monthFile));
          for (const art of articles) {
            const url = art.url as string;
            if (dedupeByUrl && url && seen.has(url)) continue;
            if (dedupeByUrl && url) seen.add(url);
            result.push(art);
          }
        }
      }
    }

    return result;
  } catch {
    return [];
  }
}

/**
 * Fallback: query Supabase crime_records for a given yearMonth and optional bundesland.
 * Returns records shaped like RawArticle + enriched fields.
 */
async function loadFromSupabase(
  yearMonth: string,
  bundesland: string | null,
): Promise<Record<string, unknown>[]> {
  const sb = getSupabase();
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

  // Paginate through all results (Supabase returns max 1000 per request)
  const PAGE = 1000;
  const allRecords: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('crime_records')
      .select('*')
      .eq('hidden', false)
      .gte('published_at', startDate)
      .lt('published_at', endDate)
      .order('published_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error || !data || data.length === 0) break;
    allRecords.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (allRecords.length === 0) return [];

  let records = allRecords;

  // Filter by bundesland using source_agency patterns
  if (bundesland && BUNDESLAND_AGENCY_PATTERNS[bundesland]) {
    const patterns = BUNDESLAND_AGENCY_PATTERNS[bundesland];
    records = records.filter(r => {
      const agency = (r.source_agency as string) || '';
      return patterns.some(p => agency.includes(p));
    });
  }

  // Reshape DB records to match the RawArticle/EnrichedArticle format
  return records.map(r => ({
    title: r.title,
    date: r.published_at,
    city: (r.location_text as string)?.split(',').pop()?.trim() || null,
    bundesland: bundesland || null,
    lat: r.latitude,
    lon: r.longitude,
    source: r.source_agency || 'database',
    url: r.source_url,
    body: r.body,
    clean_title: r.clean_title,
    classification: r.classification,
    location: {
      city: (r.location_text as string)?.split(',').pop()?.trim(),
      street: (r.location_text as string)?.split(',').slice(0, -1).join(',').trim(),
      lat: r.latitude,
      lon: r.longitude,
      precision: r.precision,
    },
    incident_time: {
      start_date: r.incident_date,
      start_time: r.incident_time,
      end_date: r.incident_end_date,
      end_time: r.incident_end_time,
      precision: r.incident_time_precision,
    },
    crime: {
      pks_category: (r.categories as string[])?.[0],
      sub_type: r.crime_sub_type,
      confidence: r.crime_confidence,
    },
    details: {
      weapon_type: r.weapon_type,
      drug_type: r.drug_type,
      victim_count: r.victim_count,
      suspect_count: r.suspect_count,
      victim_age: r.victim_age,
      suspect_age: r.suspect_age,
      victim_gender: r.victim_gender,
      suspect_gender: r.suspect_gender,
      victim_herkunft: r.victim_herkunft,
      suspect_herkunft: r.suspect_herkunft,
      severity: r.severity,
      motive: r.motive,
      damage_amount_eur: r.damage_amount_eur,
      damage_estimate: r.damage_estimate,
      victim_description: r.victim_description,
      suspect_description: r.suspect_description,
    },
    incident_group_id: r.incident_group_id,
    group_role: r.group_role,
    pipeline_run: r.pipeline_run,
    _source: 'database',
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const yearMonth = searchParams.get('yearMonth');
  const bundesland = searchParams.get('bundesland');
  const viewParam = searchParams.get('view');
  const view = viewParam === 'meta' || viewParam === 'detail' ? viewParam : null;
  const indexParam = searchParams.get('index');
  const index = indexParam != null ? Number(indexParam) : null;
  const category = searchParams.get('category') || null;
  const subType = searchParams.get('subType') || null;
  const search = searchParams.get('search') || null;

  if (!yearMonth) {
    return NextResponse.json({ error: 'yearMonth parameter required' }, { status: 400 });
  }
  if (view === 'detail' && (index == null || !Number.isInteger(index) || index < 0)) {
    return NextResponse.json({ error: 'Valid non-negative index required for detail view' }, { status: 400 });
  }

  try {
    const cacheKey = `${yearMonth}|${bundesland || ''}`;
    const now = Date.now();
    const cached = chunksResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const opts = extractFilterOptions(cached.value.articles, category);
      const filtered = applyFilters(cached.value, category, subType, search);
      return NextResponse.json(formatChunksResponse(filtered, view, index, opts));
    }

    let raw: Record<string, unknown>[] = [];
    let enriched: Record<string, unknown>[] = [];

    // Flat directory scan — filter by yearMonth and optional bundesland
    raw = loadArticlesFromFlatDir(CHUNKS_RAW_DIR, yearMonth, bundesland, true);
    enriched = loadArticlesFromFlatDir(CHUNKS_ENRICHED_DIR, yearMonth, bundesland, false);

    // Fallback: check for _enriched files in chunks/raw/
    if (enriched.length === 0) {
      enriched = loadEnrichedFromFlatDir(CHUNKS_RAW_DIR, yearMonth, bundesland, false);
    }

    // Fallback: if no local files found, query Supabase
    let dataSource: DataSource = 'files';
    if (raw.length === 0 && enriched.length === 0) {
      const dbArticles = await loadFromSupabase(yearMonth, bundesland || null);
      if (dbArticles.length > 0) {
        enriched = dbArticles;
        dataSource = 'database';
      }
    }

    // Load enrichment cache for junk/feuerwehr lookups
    const enrichmentCache = loadEnrichmentCache();

    // Determine primary article list: use raw if available, otherwise use enriched
    // (enriched articles contain all raw fields too)
    const primaryList = raw.length > 0 ? raw : enriched;

    // Build URL→cache lookup (only for displayed articles)
    const cacheByUrl: Record<string, unknown> = {};
    for (const art of primaryList) {
      const url = art.url as string;
      const body = art.body as string;
      if (url && body) {
        const key = createHash('sha256').update(`${url}:${body}`).digest('hex').slice(0, 16);
        if (enrichmentCache[key]) {
          cacheByUrl[url] = enrichmentCache[key];
        }
      }
    }

    // Match enriched articles to primary by URL for side-by-side comparison
    const enrichedByUrl: Record<string, Record<string, unknown>[]> = {};
    for (const art of enriched) {
      const url = (art.url as string) || '';
      if (!enrichedByUrl[url]) enrichedByUrl[url] = [];
      enrichedByUrl[url].push(art);
    }

    // For each primary article, attach its enriched version(s) and cache status.
    // Keep empty arrays when no enriched match exists so the UI can show
    // "not processed yet" instead of rendering raw fields as enriched output.
    const paired = primaryList.map(primaryArt => {
      const url = (primaryArt.url as string) || '';
      const enrichedMatches = enrichedByUrl[url] ?? [];
      return {
        raw: primaryArt,
        enriched: enrichedMatches,
        cacheEntry: cacheByUrl[url] ?? null,
      };
    });

    const payload: FullChunksPayload = {
      yearMonth,
      bundesland,
      dataSource,
      total: paired.length,
      articles: paired,
    };

    chunksResponseCache.set(cacheKey, {
      value: payload,
      expiresAt: now + CHUNKS_RESPONSE_CACHE_TTL_MS,
    });
    for (const [key, value] of chunksResponseCache) {
      if (value.expiresAt <= now) {
        chunksResponseCache.delete(key);
      }
    }

    const filterOptions = extractFilterOptions(payload.articles, category);
    const filtered = applyFilters(payload, category, subType, search);
    return NextResponse.json(formatChunksResponse(filtered, view, index, filterOptions));
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load chunk data', details: String(error) },
      { status: 500 }
    );
  }
}
