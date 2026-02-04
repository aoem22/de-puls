/**
 * Shared utilities for data processing scripts
 */

/**
 * Parse a value from Excel that may be a number, string, or missing value indicator
 * Returns null for missing/invalid values, otherwise the parsed number
 */
export function parseValue(val: unknown): number | null {
  // Handle common missing value indicators
  if (val === '-' || val === '.' || val === '...' || val === null || val === undefined) {
    return null;
  }

  // Handle Deutschlandatlas missing value code
  if (typeof val === 'number' && val === -9999) {
    return null;
  }

  // Already a number
  if (typeof val === 'number') return val;

  // Try to parse string
  const str = String(val).replace(/\s/g, '');
  if (str === '-9999') return null;

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Normalize an AGS (Amtlicher Gemeindeschlüssel) code to 5-digit format
 * Handles various input formats from different data sources
 */
export function normalizeAgs(ags: string | number): string {
  const agsStr = String(ags);

  // Deutschlandatlas format: 7 digits like 1001000 for Flensburg
  // Last 3 digits are always 000, drop them and pad to 5
  if (agsStr.length === 7) {
    const kreisCode = agsStr.slice(0, -3);
    return kreisCode.padStart(5, '0');
  }

  // Standard Kreis-level: pad to 5 digits
  return agsStr.padStart(5, '0');
}
