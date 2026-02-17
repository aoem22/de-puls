/**
 * Shared utilities for flat chunk file naming with German months.
 *
 * Naming convention:
 *   Old: chunks/raw/{bundesland}/{year}/{MM}.json
 *   New: chunks/raw/{bundesland}_{german_month}_{year}.json
 *
 * Internal yearMonth format ("2024-01") remains canonical throughout the code.
 */

export const GERMAN_MONTHS: Record<string, string> = {
  '01': 'januar',
  '02': 'februar',
  '03': 'maerz',
  '04': 'april',
  '05': 'mai',
  '06': 'juni',
  '07': 'juli',
  '08': 'august',
  '09': 'september',
  '10': 'oktober',
  '11': 'november',
  '12': 'dezember',
};

export const GERMAN_MONTHS_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(GERMAN_MONTHS).map(([k, v]) => [v, k])
);

/** Build a flat chunk filename: e.g. "hessen_januar_2024.json" */
export function chunkFilename(bundesland: string, yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const germanMonth = GERMAN_MONTHS[month];
  if (!germanMonth) throw new Error(`Invalid month: ${month}`);
  return `${bundesland}_${germanMonth}_${year}.json`;
}

/**
 * Parse a flat chunk filename back to { bundesland, yearMonth }.
 * e.g. "hessen_januar_2024.json" → { bundesland: "hessen", yearMonth: "2024-01" }
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseChunkFilename(filename: string): { bundesland: string; yearMonth: string } | null {
  if (!filename.endsWith('.json')) return null;
  const name = filename.slice(0, -5); // strip ".json"

  // Split from right: {bundesland}_{germanMonth}_{year}
  // bundesland may contain hyphens but not underscores
  const lastUnderscore = name.lastIndexOf('_');
  if (lastUnderscore === -1) return null;

  const year = name.slice(lastUnderscore + 1);
  const rest = name.slice(0, lastUnderscore);

  const secondLastUnderscore = rest.lastIndexOf('_');
  if (secondLastUnderscore === -1) return null;

  const germanMonth = rest.slice(secondLastUnderscore + 1);
  const bundesland = rest.slice(0, secondLastUnderscore);

  const monthNum = GERMAN_MONTHS_REVERSE[germanMonth];
  if (!monthNum || !/^\d{4}$/.test(year) || !bundesland) return null;

  return { bundesland, yearMonth: `${year}-${monthNum}` };
}

/** Check if a flat chunk filename matches a given yearMonth. */
export function filenameMatchesYearMonth(filename: string, yearMonth: string): boolean {
  const parsed = parseChunkFilename(filename);
  if (!parsed) return false;
  return parsed.yearMonth === yearMonth;
}
