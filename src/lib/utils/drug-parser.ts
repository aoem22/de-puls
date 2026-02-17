/**
 * Drug type extraction and filtering utilities.
 *
 * Shared between the local enriched-data layer and Supabase dashboard queries.
 */

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

export function extractDrugTypes(rawDrugType: string | null): string[] {
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

export function hasSelectedDrugType(rawDrugType: string | null, selectedDrugTypes: Set<string>): boolean {
  if (selectedDrugTypes.size === 0) return false;
  const drugTypes = extractDrugTypes(rawDrugType);
  for (const drugType of drugTypes) {
    if (selectedDrugTypes.has(drugType)) return true;
  }
  return false;
}

export function filterByDrugType<T extends { drug_type: string | null }>(
  records: T[],
  drugType: string | null,
): T[] {
  if (!drugType) return records;
  const selectedDrugTypes = new Set(extractDrugTypes(drugType));
  if (selectedDrugTypes.size === 0) return [];
  return records.filter((record) => hasSelectedDrugType(record.drug_type, selectedDrugTypes));
}
