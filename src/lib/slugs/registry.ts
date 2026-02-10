import fs from 'fs';
import path from 'path';
import type { KreisSlugEntry } from './types';
import { BUNDESLAND_BY_CODE } from './bundesland-registry';

// ---------------------------------------------------------------------------
// Slugify helper
// ---------------------------------------------------------------------------

const UMLAUT_MAP: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
};

function stripPrefix(name: string): { bare: string; type: 'stadt' | 'kreis' } {
  if (name.startsWith('Kreisfreie Stadt ') || name.startsWith('Stadtkreis ')) {
    const prefix = name.startsWith('Kreisfreie Stadt ') ? 'Kreisfreie Stadt ' : 'Stadtkreis ';
    return { bare: name.slice(prefix.length), type: 'stadt' };
  }
  for (const pfx of ['Landkreis ', 'Kreis ', 'Regionalverband ']) {
    if (name.startsWith(pfx)) {
      return { bare: name.slice(pfx.length), type: 'kreis' };
    }
  }
  return { bare: name, type: 'stadt' };
}

function slugify(text: string): string {
  let s = text.toLowerCase();
  for (const [from, to] of Object.entries(UMLAUT_MAP)) {
    s = s.replaceAll(from, to);
  }
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Parse kreise.json once at module load
// ---------------------------------------------------------------------------

interface KreisFeature {
  properties: { ags: string; name: string; bundesland: string };
}

const kreisJsonPath = path.join(process.cwd(), 'lib/data/geo/kreise.json');
const kreiseRaw = JSON.parse(fs.readFileSync(kreisJsonPath, 'utf-8')) as { features: KreisFeature[] };
const features = kreiseRaw.features;

// First pass: group by bare slug to detect collisions
const bareSlugGroups = new Map<string, Array<{
  ags: string; fullName: string; name: string; type: 'stadt' | 'kreis'; bundeslandCode: string;
}>>();

for (const feat of features) {
  const { ags, name: fullName, bundesland } = feat.properties;
  const { bare, type } = stripPrefix(fullName);
  const slug = slugify(bare);
  if (!bareSlugGroups.has(slug)) bareSlugGroups.set(slug, []);
  bareSlugGroups.get(slug)!.push({ ags, fullName, name: bare, type, bundeslandCode: bundesland });
}

// Second pass: resolve collisions — Stadt gets bare slug, Kreis gets -kreis suffix
const entries: KreisSlugEntry[] = [];

for (const [bareSlug, group] of bareSlugGroups) {
  if (group.length === 1) {
    const g = group[0];
    const bl = BUNDESLAND_BY_CODE[g.bundeslandCode];
    entries.push({
      ags: g.ags,
      slug: bareSlug,
      name: g.name,
      fullName: g.fullName,
      bundeslandCode: g.bundeslandCode,
      bundeslandSlug: bl?.slug ?? g.bundeslandCode,
      type: g.type,
    });
  } else {
    for (const g of group) {
      const bl = BUNDESLAND_BY_CODE[g.bundeslandCode];
      const finalSlug = g.type === 'stadt' ? bareSlug : `${bareSlug}-kreis`;
      entries.push({
        ags: g.ags,
        slug: finalSlug,
        name: g.name,
        fullName: g.fullName,
        bundeslandCode: g.bundeslandCode,
        bundeslandSlug: bl?.slug ?? g.bundeslandCode,
        type: g.type,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Look up a Kreis by its URL slug */
export const KREIS_BY_SLUG: Record<string, KreisSlugEntry> = Object.fromEntries(
  entries.map((e) => [e.slug, e])
);

/** Look up a Kreis by its AGS code */
export const KREIS_BY_AGS: Record<string, KreisSlugEntry> = Object.fromEntries(
  entries.map((e) => [e.ags, e])
);

/** All city slugs for generateStaticParams (400 entries) */
export const ALL_CITY_SLUGS: string[] = entries.map((e) => e.slug);

/** All entries grouped by Bundesland code */
export function getKreiseByBundesland(bundeslandCode: string): KreisSlugEntry[] {
  return entries.filter((e) => e.bundeslandCode === bundeslandCode);
}

/** Export slugify for reuse */
export { slugify };
