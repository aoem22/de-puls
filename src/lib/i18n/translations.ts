export type Language = 'de' | 'en';

export const translations = {
  // General
  close: { de: 'Schließen', en: 'Close' },
  search: { de: 'Suchen...', en: 'Search...' },
  searchKreis: { de: 'Kreis suchen...', en: 'Search district...' },
  noResults: { de: 'Keine Ergebnisse', en: 'No results' },
  noDataAvailable: { de: 'Keine Daten verfügbar', en: 'No data available' },
  backToList: { de: 'Zurück zur Rangliste', en: 'Back to ranking' },
  showAll: { de: 'Alle anzeigen', en: 'Show all' },
  of: { de: 'von', en: 'of' },
  shown: { de: 'angezeigt', en: 'shown' },

  // Layer Control
  primaryIndicator: { de: 'Primär-Indikator', en: 'Primary Indicator' },
  originRegion: { de: 'Herkunftsregion', en: 'Origin Region' },
  crimeType: { de: 'Straftat', en: 'Crime Type' },
  indicator: { de: 'Indikator', en: 'Indicator' },
  timeSeries: { de: 'Zeitreihe', en: 'Time Series' },
  legend: { de: 'Legende', en: 'Legend' },
  categories: { de: 'Kategorien', en: 'Categories' },
  located: { de: 'verortet', en: 'located' },

  // Crime metrics
  frequencyHz: { de: 'Häufigkeit (HZ)', en: 'Frequency (HZ)' },
  clearanceAq: { de: 'Aufklärung (AQ)', en: 'Clearance (AQ)' },
  casesPerPopulation: { de: 'Fälle pro 100.000 Einwohner', en: 'Cases per 100,000 population' },
  clearanceRatePercent: { de: 'Aufklärungsquote in %', en: 'Clearance rate in %' },

  // Legend colors
  yellowLow: { de: 'Gelb', en: 'Yellow' },
  redHigh: { de: 'Rot', en: 'Red' },
  greenLow: { de: 'Grün', en: 'Green' },
  low: { de: 'niedrig', en: 'low' },
  high: { de: 'hoch', en: 'high' },
  few: { de: 'wenig', en: 'few' },
  many: { de: 'viel', en: 'many' },
  higherIsBetter: { de: 'Höher ist besser', en: 'Higher is better' },
  lowerIsBetter: { de: 'Niedriger ist besser', en: 'Lower is better' },
  value: { de: 'Wert', en: 'Value' },

  // Ranking Panel
  ranking: { de: 'Rangliste', en: 'Ranking' },
  openRanking: { de: 'Rangliste öffnen', en: 'Open ranking' },
  districts: { de: 'Kreise', en: 'Districts' },

  // Detail Panel - Ausländer
  totalForeigners: { de: 'Gesamt Ausländer', en: 'Total Foreigners' },
  current: { de: 'Aktuell', en: 'Current' },
  byContinent: { de: 'Nach Kontinent', en: 'By Continent' },
  otherGroups: { de: 'Weitere Gruppen', en: 'Other Groups' },
  male: { de: 'Männlich', en: 'Male' },
  female: { de: 'Weiblich', en: 'Female' },

  // Detail Panel - Deutschlandatlas
  importantIndicators: { de: 'Wichtige Indikatoren', en: 'Key Indicators' },
  allIndicators: { de: 'Alle Indikatoren', en: 'All Indicators' },

  // Blaulicht Detail Panel
  pressRelease: { de: 'Pressemitteilung', en: 'Press Release' },
  report: { de: 'Meldung', en: 'Report' },
  openSource: { de: 'Quelle öffnen', en: 'Open source' },
  accuracy: { de: 'Genauigkeit', en: 'Accuracy' },
  other: { de: 'Sonstiges', en: 'Other' },

  // Indicators (main categories)
  indicators: {
    auslaender: { de: 'Ausländer nach Herkunft', en: 'Foreigners by Origin' },
    deutschlandatlas: { de: 'Deutschlandatlas', en: 'Germany Atlas' },
    kriminalstatistik: { de: 'Kriminalstatistik', en: 'Crime Statistics' },
    blaulicht: { de: 'Blaulicht-Meldungen', en: 'Police Reports' },
  },

  indicatorDescriptions: {
    auslaender: {
      de: 'Ausländische Bevölkerung nach Herkunftsregion auf Kreisebene',
      en: 'Foreign population by region of origin at district level'
    },
    deutschlandatlas: {
      de: 'Sozioökonomische Indikatoren aus dem Deutschlandatlas der Bundesregierung',
      en: 'Socioeconomic indicators from the German government\'s Germany Atlas'
    },
    kriminalstatistik: {
      de: 'Polizeiliche Kriminalstatistik für Großstädte',
      en: 'Police crime statistics for major cities'
    },
    blaulicht: {
      de: 'Aktuelle Polizei- und Feuerwehrmeldungen aus Presseportalen',
      en: 'Current police and fire department reports from press portals'
    },
  },

  // Ausländer regions
  regions: {
    total: { de: 'Gesamt', en: 'Total' },
    europa: { de: 'Europa', en: 'Europe' },
    asien: { de: 'Asien', en: 'Asia' },
    afrika: { de: 'Afrika', en: 'Africa' },
    amerika: { de: 'Amerika', en: 'Americas' },
    ozeanien: { de: 'Ozeanien', en: 'Oceania' },
    eu27: { de: 'EU-27', en: 'EU-27' },
    drittstaaten: { de: 'Drittstaaten', en: 'Third Countries' },
    gastarbeiter: { de: 'Gastarbeiterländer', en: 'Guest Worker Countries' },
    exjugoslawien: { de: 'Ex-Jugoslawien', en: 'Former Yugoslavia' },
    exsowjetunion: { de: 'Ex-Sowjetunion', en: 'Former Soviet Union' },
    tuerkei: { de: 'Türkei', en: 'Turkey' },
    syrien: { de: 'Syrien', en: 'Syria' },
    ukraine: { de: 'Ukraine', en: 'Ukraine' },
    afghanistan: { de: 'Afghanistan', en: 'Afghanistan' },
    irak: { de: 'Irak', en: 'Iraq' },
  },

  regionCategories: {
    overview: { de: 'Übersicht', en: 'Overview' },
    continents: { de: 'Kontinente', en: 'Continents' },
    regions: { de: 'Regionen', en: 'Regions' },
    topCountries: { de: 'Top Länder', en: 'Top Countries' },
  },

  // Crime categories (Blaulicht) - keys must match CrimeCategory type
  crimeCategories: {
    murder: { de: 'Tötungsdelikt', en: 'Homicide' },
    knife: { de: 'Messerangriff', en: 'Knife Attack' },
    weapons: { de: 'Waffen', en: 'Weapons' },
    sexual: { de: 'Sexualdelikte', en: 'Sexual Offenses' },
    assault: { de: 'Körperverletzung', en: 'Assault' },
    robbery: { de: 'Raub', en: 'Robbery' },
    burglary: { de: 'Einbruch', en: 'Burglary' },
    arson: { de: 'Brandstiftung', en: 'Arson' },
    drugs: { de: 'Drogen', en: 'Drugs' },
    fraud: { de: 'Betrug', en: 'Fraud' },
    vandalism: { de: 'Sachbeschädigung', en: 'Vandalism' },
    traffic: { de: 'Verkehr', en: 'Traffic' },
    missing_person: { de: 'Vermisst', en: 'Missing Person' },
    other: { de: 'Sonstiges', en: 'Other' },
  },

  // Deutschlandatlas categories
  atlasCategories: {
    economy: { de: 'Wirtschaft & Arbeit', en: 'Economy & Work' },
    social: { de: 'Soziales', en: 'Social' },
    education: { de: 'Bildung', en: 'Education' },
    health: { de: 'Gesundheit', en: 'Health' },
    environment: { de: 'Umwelt', en: 'Environment' },
    infrastructure: { de: 'Infrastruktur', en: 'Infrastructure' },
    demographics: { de: 'Demografie', en: 'Demographics' },
    politics: { de: 'Politik', en: 'Politics' },
  },

  // Deutschlandatlas indicators (key ones)
  atlasIndicators: {
    kinder_bg: { de: 'Kinder in Bedarfsgemeinschaften', en: 'Children in welfare households' },
    alq: { de: 'Arbeitslosenquote', en: 'Unemployment rate' },
    sozsich: { de: 'Mindestsicherungsquote', en: 'Social security rate' },
    hh_veink: { de: 'Verfügbares Einkommen', en: 'Disposable income' },
    bev_ausl: { de: 'Ausländeranteil', en: 'Foreign population share' },
    straft: { de: 'Straftaten', en: 'Criminal offenses' },
    schule_oabschl: { de: 'Ohne Schulabschluss', en: 'Without school diploma' },
    wahl_beteil: { de: 'Wahlbeteiligung', en: 'Voter turnout' },
    arzt_dichte: { de: 'Ärztedichte', en: 'Physician density' },
    breitband: { de: 'Breitbandversorgung', en: 'Broadband coverage' },
    pkw_dichte: { de: 'PKW-Dichte', en: 'Car density' },
    einw_dichte: { de: 'Einwohnerdichte', en: 'Population density' },
  },

  // City crime types
  cityeCrimeTypes: {
    total: { de: 'Straftaten insgesamt', en: 'Total offenses' },
    violent: { de: 'Gewaltkriminalität', en: 'Violent crime' },
    theft: { de: 'Diebstahl', en: 'Theft' },
    burglary: { de: 'Wohnungseinbruch', en: 'Residential burglary' },
    robbery: { de: 'Raub', en: 'Robbery' },
    assault: { de: 'Körperverletzung', en: 'Assault' },
    fraud: { de: 'Betrug', en: 'Fraud' },
    drugs: { de: 'Rauschgiftdelikte', en: 'Drug offenses' },
  },

  crimeCrimeCategories: {
    all: { de: 'Alle Straftaten', en: 'All Offenses' },
    violent: { de: 'Gewaltkriminalität', en: 'Violent Crime' },
    property: { de: 'Eigentumskriminalität', en: 'Property Crime' },
    other: { de: 'Sonstige', en: 'Other' },
  },

  // Location precision levels
  precisionLevels: {
    street: { de: 'Straße', en: 'Street' },
    neighborhood: { de: 'Stadtteil', en: 'Neighborhood' },
    city: { de: 'Stadt', en: 'City' },
    region: { de: 'Region', en: 'Region' },
    unknown: { de: 'Unbekannt', en: 'Unknown' },
    none: { de: 'Keine', en: 'None' },
  },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Language): string {
  const entry = translations[key];
  if (typeof entry === 'object' && 'de' in entry && 'en' in entry) {
    return entry[lang];
  }
  return key;
}

// Helper for nested translations
export function tNested<T extends keyof typeof translations>(
  category: T,
  key: string,
  lang: Language
): string {
  const categoryObj = translations[category];
  if (typeof categoryObj === 'object' && key in categoryObj) {
    const entry = (categoryObj as Record<string, { de: string; en: string }>)[key];
    if (entry && typeof entry === 'object' && 'de' in entry) {
      return entry[lang];
    }
  }
  return key;
}
