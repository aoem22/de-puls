import type { MetadataRoute } from 'next';
import { ALL_CITY_SLUGS, KREIS_BY_SLUG } from '@/lib/slugs/registry';
import { ALL_CRIME_SLUGS, CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { ALL_BUNDESLAND_SLUGS } from '@/lib/slugs/bundesland-registry';
import { ALL_MONTH_SLUGS } from '@/lib/slugs/month-slugs';
import { supabase } from '@/lib/supabase/client';
import type { CrimeCategory } from '@/lib/types/crime';

/** Minimum number of records for a city+crime combo to appear in the sitemap */
const MIN_RECORDS = 3;

/**
 * Build a reverse lookup: bare Kreis name → city slug.
 * Handles suffix mismatches (e.g. DB has "Ludwigshafen", registry has
 * "Ludwigshafen am Rhein") by also indexing the first word(s) before
 * common suffixes like "am", "an der", "in der", "ob der".
 */
function buildCityNameToSlug(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [slug, entry] of Object.entries(KREIS_BY_SLUG)) {
    // Exact bare name
    map[entry.name] = slug;

    // Also index shortened forms for "X am Y" / "X an der Y" patterns
    const suffixRe = /^(.+?)\s+(?:am|an der|in der|ob der|i\.d\.|a\.d\.)\s+/i;
    const m = entry.name.match(suffixRe);
    if (m) {
      const short = m[1];
      // Only add if no collision with another Kreis
      if (!map[short]) map[short] = slug;
    }
  }
  return map;
}

const CITY_NAME_TO_SLUG = buildCityNameToSlug();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    // Home
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  // 16 Bundesland hub pages
  for (const slug of ALL_BUNDESLAND_SLUGS) {
    entries.push({
      url: `${siteUrl}/land/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  // 14 national crime type pages
  for (const slug of ALL_CRIME_SLUGS) {
    entries.push({
      url: `${siteUrl}/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  // 224 state + crime type pages
  for (const bl of ALL_BUNDESLAND_SLUGS) {
    for (const crime of ALL_CRIME_SLUGS) {
      entries.push({
        url: `${siteUrl}/land/${bl}/${crime}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }

  // 400 city overview pages
  for (const slug of ALL_CITY_SLUGS) {
    entries.push({
      url: `${siteUrl}/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // --- Threshold-filtered city + crime type pages ---
  // Only include combos that have >= MIN_RECORDS in the database
  const validCombos = await fetchValidCityCrimeCombos();

  for (const citySlug of ALL_CITY_SLUGS) {
    for (const crimeSlug of ALL_CRIME_SLUGS) {
      if (validCombos.has(`${citySlug}:${crimeSlug}`)) {
        entries.push({
          url: `${siteUrl}/${citySlug}/${crimeSlug}`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.5,
        });
      }
    }
  }

  // Archive pages
  const archiveYears = ['2025', '2026'];
  for (const year of archiveYears) {
    entries.push({
      url: `${siteUrl}/archiv/${year}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    });
    for (const month of ALL_MONTH_SLUGS) {
      entries.push({
        url: `${siteUrl}/archiv/${year}/${month}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.4,
      });
    }
  }

  // PLZ pages are NOT in sitemap — discovered via internal links from city pages

  return entries;
}

/**
 * Fetch valid city+crime combos from Supabase and return a Set of
 * "citySlug:crimeSlug" strings for fast lookup.
 */
async function fetchValidCityCrimeCombos(): Promise<Set<string>> {
  const { data, error } = await (supabase as any).rpc('sitemap_city_crime_counts', {
    min_count: MIN_RECORDS,
  });

  if (error) {
    console.error('sitemap: failed to fetch city crime counts, falling back to all combos', error);
    // Fallback: include all combos (same as before)
    const all = new Set<string>();
    for (const citySlug of ALL_CITY_SLUGS) {
      for (const crimeSlug of ALL_CRIME_SLUGS) {
        all.add(`${citySlug}:${crimeSlug}`);
      }
    }
    return all;
  }

  const combos = new Set<string>();
  for (const row of data as Array<{ city: string; category: string; cnt: number }>) {
    const citySlug = CITY_NAME_TO_SLUG[row.city];
    const crimeEntry = CRIME_SLUG_MAP[row.category as CrimeCategory];
    if (citySlug && crimeEntry) {
      combos.add(`${citySlug}:${crimeEntry.slug}`);
    }
  }

  return combos;
}
