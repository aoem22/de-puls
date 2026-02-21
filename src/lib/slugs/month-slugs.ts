export interface MonthSlugEntry {
  slug: string;
  label: string;
  num: number;
}

export const MONTH_SLUGS: MonthSlugEntry[] = [
  { slug: 'januar', label: 'Januar', num: 1 },
  { slug: 'februar', label: 'Februar', num: 2 },
  { slug: 'maerz', label: 'März', num: 3 },
  { slug: 'april', label: 'April', num: 4 },
  { slug: 'mai', label: 'Mai', num: 5 },
  { slug: 'juni', label: 'Juni', num: 6 },
  { slug: 'juli', label: 'Juli', num: 7 },
  { slug: 'august', label: 'August', num: 8 },
  { slug: 'september', label: 'September', num: 9 },
  { slug: 'oktober', label: 'Oktober', num: 10 },
  { slug: 'november', label: 'November', num: 11 },
  { slug: 'dezember', label: 'Dezember', num: 12 },
];

export const MONTH_BY_SLUG: Record<string, MonthSlugEntry> = Object.fromEntries(
  MONTH_SLUGS.map((m) => [m.slug, m]),
);

export const ALL_MONTH_SLUGS: string[] = MONTH_SLUGS.map((m) => m.slug);
