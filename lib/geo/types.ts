/**
 * Geographic Level Types for German Administrative Boundaries
 *
 * Germany uses the AGS (Amtlicher Gemeindeschlüssel) system:
 * - 2 digits: Bundesland (16 states)
 * - 5 digits: Kreis (400 counties/districts)
 * - 8 digits: Gemeinde (11,000 municipalities)
 */

export type GeoLevel = 'bundesland' | 'kreis' | 'gemeindeverband' | 'gemeinde' | 'city' | 'point';

export interface GeoLevelConfig {
  level: GeoLevel;
  agsDigits: 2 | 5 | 8;
  dataset: string; // OpenDataSoft dataset name
  agsField: string; // Field name for AGS in source
  nameField: string; // Field name for name
  simplifyTolerance: number; // Degrees (~100m per 0.001)
}

/**
 * Configuration for each geographic level
 * Data source: BKG VG250 via OpenDataSoft API
 */
export const GEO_LEVELS: Record<GeoLevel, GeoLevelConfig> = {
  bundesland: {
    level: 'bundesland',
    agsDigits: 2,
    dataset: 'georef-germany-land',
    agsField: 'lan_code',
    nameField: 'lan_name',
    simplifyTolerance: 0.005,
  },
  kreis: {
    level: 'kreis',
    agsDigits: 5,
    dataset: 'georef-germany-kreis',
    agsField: 'krs_code',
    nameField: 'krs_name',
    simplifyTolerance: 0.01, // ~1km tolerance, optimized for national-level viewing
  },
  gemeindeverband: {
    level: 'gemeindeverband',
    agsDigits: 8,
    dataset: 'georef-germany-gemeindeverband',
    agsField: 'vwg_code',
    nameField: 'vwg_name',
    simplifyTolerance: 0.001,
  },
  gemeinde: {
    level: 'gemeinde',
    agsDigits: 8,
    dataset: 'georef-germany-gemeinde',
    agsField: 'gem_code',
    nameField: 'gem_name',
    simplifyTolerance: 0.0005,
  },
  city: {
    level: 'city',
    agsDigits: 8,
    dataset: 'city-crimes', // Custom dataset, not from OpenDataSoft
    agsField: 'gemeindeschluessel',
    nameField: 'name',
    simplifyTolerance: 0.001,
  },
  point: {
    level: 'point',
    agsDigits: 8,
    dataset: 'blaulicht-crimes', // Point-based crime data
    agsField: '',
    nameField: '',
    simplifyTolerance: 0,
  },
};

/**
 * Standard properties for geo features after processing
 */
export interface GeoFeatureProps {
  ags: string;
  name: string;
  bundesland: string; // 2-digit Bundesland code
}

// ============ AGS Hierarchy Utilities ============

/**
 * Extract parent AGS from a more detailed AGS code
 */
export function getParentAgs(ags: string, targetLevel: GeoLevel): string {
  const digits = GEO_LEVELS[targetLevel].agsDigits;
  return ags.substring(0, digits);
}

/**
 * Get the 2-digit Bundesland code from any AGS
 */
export function getBundeslandFromAgs(ags: string): string {
  return ags.substring(0, 2);
}

/**
 * Get the 5-digit Kreis code from any AGS (must be at least 5 digits)
 */
export function getKreisFromAgs(ags: string): string {
  return ags.substring(0, 5);
}

/**
 * Validate AGS code format
 */
export function isValidAgs(ags: string, level?: GeoLevel): boolean {
  if (!/^\d+$/.test(ags)) return false;

  if (level) {
    return ags.length === GEO_LEVELS[level].agsDigits;
  }

  // Valid if it matches any level's digit count
  return ags.length === 2 || ags.length === 5 || ags.length === 8;
}

/**
 * Get the geographic level based on AGS digit count
 */
export function getGeoLevelFromAgs(ags: string): GeoLevel | null {
  switch (ags.length) {
    case 2:
      return 'bundesland';
    case 5:
      return 'kreis';
    case 8:
      // Could be gemeindeverband or gemeinde - default to gemeinde
      return 'gemeinde';
    default:
      return null;
  }
}
