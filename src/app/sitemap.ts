import type { MetadataRoute } from 'next';
import { ALL_CITY_SLUGS } from '@/lib/slugs/registry';
import { ALL_CRIME_SLUGS } from '@/lib/slugs/crime-slugs';
import { ALL_BUNDESLAND_SLUGS } from '@/lib/slugs/bundesland-registry';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de';
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

  // 400 city overview pages
  for (const slug of ALL_CITY_SLUGS) {
    entries.push({
      url: `${siteUrl}/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // 5,600 city + crime type pages
  for (const citySlug of ALL_CITY_SLUGS) {
    for (const crimeSlug of ALL_CRIME_SLUGS) {
      entries.push({
        url: `${siteUrl}/${citySlug}/${crimeSlug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  }

  return entries;
}
