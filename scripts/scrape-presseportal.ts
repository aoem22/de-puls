import fs from 'fs/promises';
import path from 'path';
import { load } from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import pLimit from 'p-limit';
import type { CrimeCategory, CrimeDataset, CrimeRecord, LocationPrecision } from '../src/lib/types/crime';

const BASE_URL = 'https://www.presseportal.de';
const ROBOTS_URL = `${BASE_URL}/robots.txt`;
const DEFAULT_RANGE_DAYS = 365;
const USER_AGENT = `kanakmap/1.0 (+contact: ${process.env.NOMINATIM_EMAIL ?? 'your-email@example.com'})`;
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS ?? '30000', 10);
const FETCH_RETRIES = Number.parseInt(process.env.FETCH_RETRIES ?? '3', 10);
const SITEMAP_CONCURRENCY = Number.parseInt(process.env.SITEMAP_CONCURRENCY ?? '4', 10);

const CATEGORY_RULES: Array<{ category: CrimeCategory; patterns: RegExp[] }> = [
  { category: 'knife', patterns: [/messer/i, /stich/i, /stach/i, /messerangriff/i] },
  { category: 'burglary', patterns: [/einbruch/i, /eingebrochen/i, /einbrecher/i, /wohnungseinbruch/i] },
  { category: 'robbery', patterns: [/raub/i, /überfall/i, /beraubt/i, /bewaffnet/i] },
  { category: 'arson', patterns: [/brandstiftung/i, /\bbrand\b/i, /feuer gelegt/i] },
  { category: 'assault', patterns: [/körperverletzung/i, /angegriffen/i, /schlug/i, /geschlagen/i] },
  { category: 'fraud', patterns: [/betrug/i, /phishing/i, /enkeltrick/i, /scam/i] },
  { category: 'traffic', patterns: [/verkehr/i, /unfall/i, /fahrerflucht/i, /trunkenheit/i, /alkohol/i] },
  { category: 'missing_person', patterns: [/vermisst/i, /vermisste/i, /suche nach/i, /fahndet nach/i] },
];

const PRECISE_TYPES = new Set(['house', 'building', 'residential', 'street']);
const NEIGHBORHOOD_TYPES = new Set(['neighbourhood', 'suburb', 'quarter', 'locality', 'hamlet']);
const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

interface ExtractedArticle {
  id: string;
  title: string;
  summary: string | null;
  publishedAt: string;
  sourceUrl: string;
  sourceAgency: string | null;
  locationText: string | null;
  bodyText: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getValue = (flag: string, fallback?: string) => {
    const index = args.indexOf(flag);
    if (index === -1 || index === args.length - 1) return fallback;
    return args[index + 1];
  };
  const hasFlag = (flag: string) => args.includes(flag);
  return {
    output: getValue('--output', path.join(process.cwd(), 'public', 'crimes.json')),
    start: getValue('--start'),
    end: getValue('--end'),
    limit: Number.parseInt(getValue('--limit', '0') ?? '0', 10),
    concurrency: Number.parseInt(getValue('--concurrency', '4') ?? '4', 10),
    geocode: hasFlag('--geocode'),
    useAi: hasFlag('--use-ai'),
  };
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function jitterCoordinates(lat: number, lon: number, seed: string): { lat: number; lon: number } {
  const hash = hashString(seed);
  const angle = (hash % 360) * (Math.PI / 180);
  const distance = 0.001 + ((hash % 100) / 100) * 0.0015;
  const deltaLat = Math.cos(angle) * distance;
  const deltaLon = Math.sin(angle) * distance;
  return { lat: lat + deltaLat, lon: lon + deltaLon };
}

function classifyByRules(text: string): { categories: CrimeCategory[]; confidence: number } {
  const matches = new Set<CrimeCategory>();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matches.add(rule.category);
    }
  }
  if (matches.size === 0) {
    return { categories: ['other'], confidence: 0.2 };
  }
  const confidence = Math.min(0.4 + matches.size * 0.15, 0.85);
  return { categories: Array.from(matches), confidence };
}

async function classifyWithAi(text: string): Promise<{ categories: CrimeCategory[]; confidence: number } | null> {
  const endpoint = process.env.AI_CLASSIFIER_URL;
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !Array.isArray(data.categories)) return null;
    return {
      categories: data.categories as CrimeCategory[],
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.6,
    };
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithRetry(url: string): Promise<string> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < FETCH_RETRIES) {
    try {
      return await fetchText(url);
    } catch (error) {
      lastError = error;
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function fetchRobotsSitemaps(): Promise<string[]> {
  const robots = await fetchTextWithRetry(ROBOTS_URL);
  return robots
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith('sitemap:'))
    .map((line) => line.split(':').slice(1).join(':').trim())
    .filter(Boolean);
}

async function parseSitemap(url: string): Promise<SitemapEntry[]> {
  try {
    const xml = await fetchTextWithRetry(url);
    const data = parser.parse(xml);
    if (data.sitemapindex?.sitemap) {
      const entries = normalizeArray<{ loc: string }>(data.sitemapindex.sitemap);
      const limiter = pLimit(Math.max(1, SITEMAP_CONCURRENCY));
      const nested = await Promise.all(
        entries.map((entry) => limiter(() => parseSitemap(entry.loc)))
      );
      return nested.flat();
    }
    if (data.urlset?.url) {
      return normalizeArray<SitemapEntry>(data.urlset.url);
    }
    return [];
  } catch (error) {
    console.warn(`Skipping sitemap due to fetch error: ${url}`);
    return [];
  }
}

function extractLocationText(rawText: string): string | null {
  const match = rawText.match(/(?:^|\n)\s*(?:Ort|ORT|Tatort)\s*:?\s*(.+)/i);
  if (!match) return null;
  const line = match[1].split('\n')[0]?.trim();
  if (!line) return null;
  return line.replace(/[-–].*$/, '').trim();
}

function getPrecisionFromGeocode(result: any, locationText: string | null): LocationPrecision {
  if (result?.address?.house_number || /(\d{1,4})/.test(locationText ?? '')) {
    return 'street';
  }
  const type = String(result?.type ?? '').toLowerCase();
  if (PRECISE_TYPES.has(type)) return 'street';
  if (NEIGHBORHOOD_TYPES.has(type)) return 'neighborhood';
  if (CITY_TYPES.has(type)) return 'city';
  return 'unknown';
}

async function geocodeLocation(locationText: string, cache: Record<string, any>): Promise<any | null> {
  const query = `${locationText}, Germany`;
  if (cache[query]) return cache[query];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'de',
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const result = Array.isArray(data) && data.length > 0 ? data[0] : null;
  cache[query] = result;
  return result;
}

function extractArticle(html: string, url: string): ExtractedArticle {
  const $ = load(html);
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    'Ohne Titel';
  const summary =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;
  const publishedAt =
    $('meta[property="article:published_time"]').attr('content')?.trim() ||
    $('meta[name="date"]').attr('content')?.trim() ||
    $('time[datetime]').attr('datetime')?.trim() ||
    new Date().toISOString();
  const sourceAgency =
    $('meta[property="article:author"]').attr('content')?.trim() ||
    $('.article__office').first().text().trim() ||
    null;

  const bodyText =
    $('[itemprop="articleBody"]').text().trim() ||
    $('.article__content').text().trim() ||
    $('.text').text().trim() ||
    '';
  const locationFromDom =
    $('.article__location').first().text().trim() ||
    $('.article-location').first().text().trim() ||
    null;
  const locationText = locationFromDom || extractLocationText(bodyText);

  const idSeed = `${url}-${publishedAt}`;
  return {
    id: `pp-${hashString(idSeed)}`,
    title,
    summary,
    publishedAt,
    sourceUrl: url,
    sourceAgency,
    locationText,
    bodyText,
  };
}

async function main() {
  const args = parseArgs();
  const endDate = args.end ? new Date(args.end) : new Date();
  const startDate = args.start
    ? new Date(args.start)
    : new Date(endDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid start or end date');
  }

  console.log('Starting scrape...');
  console.log(`Range: ${toISODate(startDate)} → ${toISODate(endDate)}`);
  console.log(`Geocoding: ${args.geocode ? 'enabled' : 'disabled'}`);

  const sitemapUrls = await fetchRobotsSitemaps();
  console.log(`Robots sitemaps: ${sitemapUrls.length}`);
  const blaulichtSitemaps = sitemapUrls.filter((url) => url.includes('sitemap') && url.includes('blaulicht'));
  console.log(`Blaulicht sitemaps: ${blaulichtSitemaps.length}`);
  const sitemapEntries = (
    await Promise.all(blaulichtSitemaps.map((url) => parseSitemap(url)))
  ).flat();

  const filteredUrls = sitemapEntries
    .filter((entry) => entry.loc.includes('/blaulicht/'))
    .filter((entry) => {
      if (!entry.lastmod) return true;
      const lastmod = new Date(entry.lastmod);
      if (Number.isNaN(lastmod.getTime())) return true;
      return lastmod >= startDate && lastmod <= endDate;
    })
    .map((entry) => entry.loc);

  const limitedUrls = args.limit > 0 ? filteredUrls.slice(0, args.limit) : filteredUrls;
  console.log(`Articles in range: ${filteredUrls.length}${args.limit > 0 ? ` (limit ${args.limit})` : ''}`);
  const limiter = pLimit(Math.max(1, args.concurrency));

  const cacheDir = path.join(process.cwd(), '.cache');
  const cachePath = path.join(cacheDir, 'presseportal-geocode.json');
  let geocodeCache: Record<string, any> = {};
  if (args.geocode) {
    try {
      const cacheText = await fs.readFile(cachePath, 'utf-8');
      geocodeCache = JSON.parse(cacheText);
    } catch {
      geocodeCache = {};
    }
    await fs.mkdir(cacheDir, { recursive: true });
  }

  const results: CrimeRecord[] = [];
  let processed = 0;
  let successCount = 0;
  let failedCount = 0;
  const total = limitedUrls.length;

  const logProgress = () => {
    console.log(`Processed ${processed}/${total} (success ${successCount}, failed ${failedCount})`);
  };

  for (const url of limitedUrls) {
    await limiter(async () => {
      try {
        const html = await fetchTextWithRetry(url);
        const extracted = extractArticle(html, url);
        const baseText = [extracted.title, extracted.summary, extracted.locationText, extracted.bodyText]
          .filter(Boolean)
          .join(' ');
        let classification = classifyByRules(baseText);
        if (args.useAi) {
          const aiResult = await classifyWithAi(baseText);
          if (aiResult) {
            classification = aiResult;
          }
        }

        let latitude: number | null = null;
        let longitude: number | null = null;
        let precision: LocationPrecision = 'unknown';
        if (args.geocode && extracted.locationText) {
          const geocodeResult = await geocodeLocation(extracted.locationText, geocodeCache);
          if (geocodeResult?.lat && geocodeResult?.lon) {
            const lat = Number.parseFloat(geocodeResult.lat);
            const lon = Number.parseFloat(geocodeResult.lon);
            precision = getPrecisionFromGeocode(geocodeResult, extracted.locationText);
            if (precision === 'street') {
              const jittered = jitterCoordinates(lat, lon, extracted.id);
              latitude = jittered.lat;
              longitude = jittered.lon;
            } else {
              latitude = lat;
              longitude = lon;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }

        const { bodyText: _bodyText, ...recordBase } = extracted;
        results.push({
          ...recordBase,
          categories: classification.categories,
          confidence: classification.confidence,
          latitude,
          longitude,
          precision,
        });
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        console.warn(`Failed article: ${url}`);
      } finally {
        processed += 1;
        if (processed % 50 === 0 || processed === total) {
          logProgress();
        }
      }
    });
  }

  if (args.geocode) {
    await fs.writeFile(cachePath, JSON.stringify(geocodeCache, null, 2), 'utf-8');
  }

  const dataset: CrimeDataset = {
    generatedAt: new Date().toISOString(),
    source: 'presseportal',
    range: {
      start: toISODate(startDate),
      end: toISODate(endDate),
    },
    records: results,
  };

  await fs.writeFile(args.output, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`Saved ${results.length} records to ${args.output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
