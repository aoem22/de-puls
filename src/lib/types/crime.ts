export type CrimeCategory =
  | 'murder'
  | 'knife'
  | 'weapons'
  | 'sexual'
  | 'assault'
  | 'robbery'
  | 'burglary'
  | 'arson'
  | 'drugs'
  | 'fraud'
  | 'vandalism'
  | 'traffic'
  | 'missing_person'
  | 'other';

export type WeaponType =
  | 'knife'
  | 'gun'
  | 'blunt'
  | 'explosive'
  | 'vehicle'
  | 'none'
  | 'unknown'
  | 'other'
  | null;

export type Gender = 'male' | 'female' | 'unknown';

export type Severity = 'minor' | 'serious' | 'critical' | 'fatal' | 'property_only' | 'unknown';

export type Motive = 'domestic' | 'robbery' | 'hate' | 'drugs' | 'road_rage' | 'dispute' | 'unknown';

export type DrugType = 'cannabis' | 'cocaine' | 'amphetamine' | 'heroin' | 'ecstasy' | 'meth' | 'other';

export type IncidentTimePrecision = 'exact' | 'approximate' | 'unknown';

export const GENDER_LABELS: Record<Gender, { de: string; en: string }> = {
  male:    { de: 'männlich', en: 'male' },
  female:  { de: 'weiblich', en: 'female' },
  unknown: { de: 'unbekannt', en: 'unknown' },
};

export const SEVERITY_LABELS: Record<Severity, { de: string; en: string; color: string }> = {
  fatal:         { de: 'Tödlich',     en: 'Fatal',         color: '#dc2626' },
  critical:      { de: 'Kritisch',    en: 'Critical',      color: '#f97316' },
  serious:       { de: 'Schwer',      en: 'Serious',       color: '#eab308' },
  minor:         { de: 'Leicht',      en: 'Minor',         color: '#6b7280' },
  property_only: { de: 'Sachschaden', en: 'Property Only', color: '#64748b' },
  unknown:       { de: 'Unbekannt',   en: 'Unknown',       color: '#4b5563' },
};

export const MOTIVE_LABELS: Record<Motive, { de: string; en: string }> = {
  domestic:  { de: 'Häusliche Gewalt', en: 'Domestic' },
  robbery:   { de: 'Raub',            en: 'Robbery' },
  hate:      { de: 'Hasskriminalität', en: 'Hate Crime' },
  drugs:     { de: 'Drogen',          en: 'Drugs' },
  road_rage: { de: 'Verkehrsstreit',  en: 'Road Rage' },
  dispute:   { de: 'Streit',          en: 'Dispute' },
  unknown:   { de: 'Unbekannt',       en: 'Unknown' },
};

export const DRUG_LABELS: Record<DrugType, { de: string; en: string }> = {
  cannabis:     { de: 'Cannabis',      en: 'Cannabis' },
  cocaine:      { de: 'Kokain',        en: 'Cocaine' },
  amphetamine:  { de: 'Amphetamin',    en: 'Amphetamine' },
  heroin:       { de: 'Heroin',        en: 'Heroin' },
  ecstasy:      { de: 'Ecstasy',       en: 'Ecstasy' },
  meth:         { de: 'Methamphetamin', en: 'Meth' },
  other:        { de: 'Sonstige',      en: 'Other' },
};

export const WEAPON_LABELS: Record<string, { de: string; en: string; icon: string }> = {
  knife:     { de: 'Messer',        en: 'Knife',      icon: '\u{1F52A}' },
  gun:       { de: 'Schusswaffe',   en: 'Firearm',    icon: '\u{1F52B}' },
  blunt:     { de: 'Schlagwaffe',   en: 'Blunt weapon', icon: '\u{1F528}' },
  explosive: { de: 'Sprengstoff',   en: 'Explosive',  icon: '\u{1F4A3}' },
  vehicle:   { de: 'Fahrzeug',      en: 'Vehicle',    icon: '\u{1F697}' },
};

export type LocationPrecision = 'street' | 'neighborhood' | 'city' | 'region' | 'unknown';

export interface CrimeRecord {
  id: string;
  title: string;
  cleanTitle?: string | null;
  summary?: string | null;
  body?: string | null; // Full press release text
  publishedAt: string;
  sourceUrl: string;
  sourceAgency?: string | null;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  precision: LocationPrecision;
  categories: CrimeCategory[];
  weaponType?: WeaponType;
  confidence: number;
  incidentDate?: string | null;
  incidentTime?: string | null;
  incidentTimePrecision?: IncidentTimePrecision | null;
  crimeSubType?: string | null;
  crimeConfidence?: number | null;
  drugType?: DrugType | null;
  victimCount?: number | null;
  suspectCount?: number | null;
  victimAge?: string | null;
  suspectAge?: string | null;
  victimGender?: Gender | null;
  suspectGender?: Gender | null;
  victimHerkunft?: string | null;
  suspectHerkunft?: string | null;
  severity?: Severity | null;
  motive?: Motive | null;
  incidentGroupId?: string | null;
  groupRole?: string | null;
  pipelineRun?: string | null;
}

export const CRIME_CATEGORIES: Array<{
  key: CrimeCategory;
  label: string;
  color: string;
}> = [
  { key: 'murder', label: 'Tötungsdelikt', color: '#7f1d1d' },      // dark red
  { key: 'knife', label: 'Messerangriff', color: '#ef4444' },       // red
  { key: 'weapons', label: 'Waffen', color: '#dc2626' },            // red-600
  { key: 'sexual', label: 'Sexualdelikte', color: '#a855f7' },      // purple
  { key: 'assault', label: 'Körperverletzung', color: '#8b5cf6' },  // violet
  { key: 'robbery', label: 'Raub', color: '#f59e0b' },              // amber
  { key: 'burglary', label: 'Einbruch', color: '#f97316' },         // orange
  { key: 'arson', label: 'Brandstiftung', color: '#e11d48' },       // rose
  { key: 'drugs', label: 'Drogen', color: '#22c55e' },              // green
  { key: 'fraud', label: 'Betrug', color: '#14b8a6' },              // teal
  { key: 'vandalism', label: 'Sachbeschädigung', color: '#64748b' },// slate
  { key: 'traffic', label: 'Verkehr', color: '#38bdf8' },           // sky
  { key: 'missing_person', label: 'Vermisst', color: '#10b981' },   // emerald
  { key: 'other', label: 'Sonstiges', color: '#94a3b8' },           // gray
];
