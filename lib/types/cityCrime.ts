/**
 * City crime statistics types based on PKS 2024 data
 * (Polizeiliche Kriminalstatistik - Police Crime Statistics)
 */

export interface CrimeStats {
  cases: number;       // Anzahl erfasste Fälle
  hz: number;          // Häufigkeitszahl - cases per 100,000 inhabitants
  aq: number;          // Aufklärungsquote - clearance rate %
}

export interface CityData {
  name: string;
  gemeindeschluessel: string;  // 8-digit municipal key (AGS)
  crimes: Partial<Record<CrimeTypeKey, CrimeStats>>;
}

export type CrimeTypeKey =
  | 'total'
  | 'totalExclResidence'
  | 'violentCrime'
  | 'murder'
  | 'rape'
  | 'robbery'
  | 'robberyBank'
  | 'robberyShop'
  | 'robberyHandbag'
  | 'robberyStreet'
  | 'robberyHome'
  | 'assaultAggravated'
  | 'assaultSimple'
  | 'theftSimple'
  | 'shoplifting'
  | 'theftAggravated'
  | 'burglaryResidential'
  | 'burglaryDaytime'
  | 'theftTotal'
  | 'theftCar'
  | 'theftMotorcycle'
  | 'theftBicycle'
  | 'theftFromCar'
  | 'pickpocketing'
  | 'fraud'
  | 'fareEvasionTotal'
  | 'fareEvasion'
  | 'embezzlement'
  | 'forgery'
  | 'resistanceTotal'
  | 'resistanceOfficer'
  | 'assaultOfficer'
  | 'receivingStolen'
  | 'arson'
  | 'propertyDamage'
  | 'propertyDamageGraffiti'
  | 'residenceViolations'
  | 'drugOffenses'
  | 'cybercrime'
  | 'streetCrime';

export interface CrimeTypeConfig {
  key: CrimeTypeKey;
  label: string;           // English label
  labelDe: string;         // German label
  category: CrimeCategory;
  description?: string;
}

export type CrimeCategory =
  | 'overview'
  | 'violent'
  | 'theft'
  | 'fraud'
  | 'other';

export const CRIME_CATEGORIES_META: Record<CrimeCategory, { label: string; labelDe: string }> = {
  overview: { label: 'Overview', labelDe: 'Übersicht' },
  violent: { label: 'Violent Crime', labelDe: 'Gewaltkriminalität' },
  theft: { label: 'Theft & Burglary', labelDe: 'Diebstahl & Einbruch' },
  fraud: { label: 'Fraud & Forgery', labelDe: 'Betrug & Fälschung' },
  other: { label: 'Other', labelDe: 'Sonstiges' },
};

export const CITY_CRIME_TYPES: CrimeTypeConfig[] = [
  // Overview
  {
    key: 'total',
    label: 'Total Crimes',
    labelDe: 'Straftaten insgesamt',
    category: 'overview',
  },
  {
    key: 'totalExclResidence',
    label: 'Total (excl. residence violations)',
    labelDe: 'Straftaten (ohne Aufenthaltsrecht)',
    category: 'overview',
  },
  {
    key: 'violentCrime',
    label: 'Violent Crime',
    labelDe: 'Gewaltkriminalität',
    category: 'overview',
  },
  {
    key: 'streetCrime',
    label: 'Street Crime',
    labelDe: 'Straßenkriminalität',
    category: 'overview',
  },
  {
    key: 'cybercrime',
    label: 'Cybercrime',
    labelDe: 'Cybercrime',
    category: 'overview',
  },

  // Violent crimes
  {
    key: 'murder',
    label: 'Murder & Manslaughter',
    labelDe: 'Mord und Totschlag',
    category: 'violent',
  },
  {
    key: 'rape',
    label: 'Rape & Sexual Assault',
    labelDe: 'Vergewaltigung/sex. Nötigung',
    category: 'violent',
  },
  {
    key: 'robbery',
    label: 'Robbery (total)',
    labelDe: 'Raub insgesamt',
    category: 'violent',
  },
  {
    key: 'robberyStreet',
    label: 'Street Robbery',
    labelDe: 'Straßenraub',
    category: 'violent',
  },
  {
    key: 'robberyHome',
    label: 'Home Invasion Robbery',
    labelDe: 'Raub in Wohnungen',
    category: 'violent',
  },
  {
    key: 'assaultAggravated',
    label: 'Aggravated Assault',
    labelDe: 'Gefährliche Körperverletzung',
    category: 'violent',
  },
  {
    key: 'assaultSimple',
    label: 'Simple Assault',
    labelDe: 'Einfache Körperverletzung',
    category: 'violent',
  },
  {
    key: 'resistanceTotal',
    label: 'Resistance to Officers',
    labelDe: 'Widerstand gg. Beamte',
    category: 'violent',
  },
  {
    key: 'arson',
    label: 'Arson',
    labelDe: 'Brandstiftung',
    category: 'violent',
  },

  // Theft & burglary
  {
    key: 'theftTotal',
    label: 'Theft (total)',
    labelDe: 'Diebstahl insgesamt',
    category: 'theft',
  },
  {
    key: 'theftSimple',
    label: 'Simple Theft',
    labelDe: 'Einfacher Diebstahl',
    category: 'theft',
  },
  {
    key: 'theftAggravated',
    label: 'Aggravated Theft',
    labelDe: 'Schwerer Diebstahl',
    category: 'theft',
  },
  {
    key: 'shoplifting',
    label: 'Shoplifting',
    labelDe: 'Ladendiebstahl',
    category: 'theft',
  },
  {
    key: 'burglaryResidential',
    label: 'Residential Burglary',
    labelDe: 'Wohnungseinbruch',
    category: 'theft',
  },
  {
    key: 'burglaryDaytime',
    label: 'Daytime Burglary',
    labelDe: 'Tageswohnungseinbruch',
    category: 'theft',
  },
  {
    key: 'theftCar',
    label: 'Car Theft',
    labelDe: 'Kfz-Diebstahl',
    category: 'theft',
  },
  {
    key: 'theftMotorcycle',
    label: 'Motorcycle Theft',
    labelDe: 'Motorrad-Diebstahl',
    category: 'theft',
  },
  {
    key: 'theftBicycle',
    label: 'Bicycle Theft',
    labelDe: 'Fahrraddiebstahl',
    category: 'theft',
  },
  {
    key: 'theftFromCar',
    label: 'Theft from Vehicles',
    labelDe: 'Diebstahl an/aus Kfz',
    category: 'theft',
  },
  {
    key: 'pickpocketing',
    label: 'Pickpocketing',
    labelDe: 'Taschendiebstahl',
    category: 'theft',
  },

  // Fraud & forgery
  {
    key: 'fraud',
    label: 'Fraud',
    labelDe: 'Betrug',
    category: 'fraud',
  },
  {
    key: 'fareEvasion',
    label: 'Fare Evasion',
    labelDe: 'Beförderungserschleichung',
    category: 'fraud',
  },
  {
    key: 'embezzlement',
    label: 'Embezzlement',
    labelDe: 'Unterschlagung',
    category: 'fraud',
  },
  {
    key: 'forgery',
    label: 'Document Forgery',
    labelDe: 'Urkundenfälschung',
    category: 'fraud',
  },
  {
    key: 'receivingStolen',
    label: 'Receiving Stolen Goods',
    labelDe: 'Hehlerei/Geldwäsche',
    category: 'fraud',
  },

  // Other
  {
    key: 'propertyDamage',
    label: 'Property Damage',
    labelDe: 'Sachbeschädigung',
    category: 'other',
  },
  {
    key: 'propertyDamageGraffiti',
    label: 'Graffiti',
    labelDe: 'Graffiti',
    category: 'other',
  },
  {
    key: 'drugOffenses',
    label: 'Drug Offenses',
    labelDe: 'Rauschgiftdelikte',
    category: 'other',
  },
  {
    key: 'residenceViolations',
    label: 'Residence Law Violations',
    labelDe: 'Aufenthaltsrecht',
    category: 'other',
  },
];

// Map from German crime type names to our keys
export const CRIME_TYPE_MAPPING: Record<string, CrimeTypeKey> = {
  'Straftaten insgesamt': 'total',
  'Straftaten insgesamt, jedoch ohne Verstöße gegen das Aufenthalts-, das Asyl- und das Freizügigkeitsgesetz/EU (Schlüssel 725000)': 'totalExclResidence',
  'Gewaltkriminalität': 'violentCrime',
  'Mord, Totschlag und Tötung auf Verlangen': 'murder',
  'Vergewaltigung, sexuelle Nötigung und sexueller Übergriff im besonders schweren Fall einschl. mit Todesfolge §§ 177, 178 StGB': 'rape',
  'Raub, räuberische Erpressung und räuberischer Angriff auf Kraftfahrer §§ 249-252, 255, 316a StGB': 'robbery',
  'Raub, räuberische Erpressung auf/gegen Geldinstitute, Postfilialen und -agenturen': 'robberyBank',
  'Raub, räuberische Erpressung auf/gegen sonstige Kassenräume und Geschäfte': 'robberyShop',
  'Handtaschenraub': 'robberyHandbag',
  'Sonstige Raubüberfälle auf Straßen, Wegen oder Plätzen': 'robberyStreet',
  'Raubüberfälle in Wohnungen': 'robberyHome',
  'Gefährliche und schwere Körperverletzung, Verstümmelung weiblicher Genitalien §§ 224, 226, 226a, 231 StGB': 'assaultAggravated',
  'Vorsätzliche einfache Körperverletzung § 223 StGB': 'assaultSimple',
  'Diebstahl ohne erschwerende Umstände §§ 242, 247, 248a-c StGB und zwar:': 'theftSimple',
  'Einfacher Ladendiebstahl': 'shoplifting',
  'Diebstahl unter erschwerenden Umständen §§ 243-244a StGB und zwar:': 'theftAggravated',
  'Wohnungseinbruchdiebstahl §§ 244 Abs. 1 Nr. 3 und Abs. 4,  244a StGB': 'burglaryResidential',
  'Tageswohnungseinbruchdiebstahl §§ 244 Abs. 1 Nr. 3 und Abs. 4, 244a StGB': 'burglaryDaytime',
  'Diebstahl insgesamt und zwar:': 'theftTotal',
  'Diebstahl insgesamt von Kraftwagen einschl. unbefugte Ingebrauchnahme': 'theftCar',
  'Diebstahl insgesamt von Mopeds und Krafträdern einschl. unbefugte Ingebrauchnahme': 'theftMotorcycle',
  'Diebstahl insgesamt von Fahrrädern einschl. unbefugte Ingebrauchnahme': 'theftBicycle',
  'Diebstahl insgesamt an/aus Kraftfahrzeugen': 'theftFromCar',
  'Taschendiebstahl insgesamt': 'pickpocketing',
  'Betrug §§ 263, 263a, 264, 264a, 265, 265a-e StGB': 'fraud',
  'Erschleichen von Leistungen § 265a StGB': 'fareEvasionTotal',
  'Beförderungserschleichung': 'fareEvasion',
  'Unterschlagung §§ 246, 247, 248a StGB': 'embezzlement',
  'Urkundenfälschung §§ 267-271, 273-279, 281 StGB': 'forgery',
  'Widerstand gegen und tätlicher Angriff auf Vollstreckungsbeamte und gleichstehende Personen §§ 113-115 StGB': 'resistanceTotal',
  'Widerstand gegen Vollstreckungsbeamte und gleichstehende Personen §§ 113, 115 StGB': 'resistanceOfficer',
  'Tätlicher Angriff auf Vollstreckungsbeamte und gleichstehende Personen §§ 114, 115 StGB': 'assaultOfficer',
  'Begünstigung, Strafvereitelung (ohne Strafvereitelung im Amt), Hehlerei und Geldwäsche §§ 257, 258, 259-261 StGB': 'receivingStolen',
  'Brandstiftung und Herbeiführen einer Brandgefahr §§ 306-306d, 306f StGB': 'arson',
  'Sachbeschädigung §§ 303-305a StGB': 'propertyDamage',
  'Sachbeschädigung durch Graffiti insgesamt': 'propertyDamageGraffiti',
  'Straftaten gegen das Aufenthalts-, das Asyl- und das Freizügigkeitsgesetz/EU': 'residenceViolations',
  'Rauschgiftdelikte (soweit nicht bereits mit anderer Schlüsselzahl erfasst)': 'drugOffenses',
  'Cybercrime': 'cybercrime',
  'Straßenkriminalität': 'streetCrime',
};

// Helper to get crime type config by key
export function getCrimeTypeConfig(key: CrimeTypeKey): CrimeTypeConfig | undefined {
  return CITY_CRIME_TYPES.find((t) => t.key === key);
}

// Group crime types by category for UI
export function getCrimeTypesByCategory(): Map<CrimeCategory, CrimeTypeConfig[]> {
  const grouped = new Map<CrimeCategory, CrimeTypeConfig[]>();
  for (const crimeType of CITY_CRIME_TYPES) {
    const list = grouped.get(crimeType.category) || [];
    list.push(crimeType);
    grouped.set(crimeType.category, list);
  }
  return grouped;
}
