/**
 * Shared formatting utilities for displaying numbers and percentages
 * Used across map components for consistent display of indicator values
 */

/**
 * Format a number with German locale, handling null/undefined
 * Returns en-dash for missing values
 */
export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined) return '–';
  return val.toLocaleString('de-DE');
}

/**
 * Format a value with German locale and configurable decimal places
 * Automatically reduces decimals for large numbers (>= 1000)
 */
export function formatValue(val: number | null | undefined, decimals: number = 1): string {
  if (val === null || val === undefined) return '–';
  if (val >= 1000) {
    return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  }
  return val.toLocaleString('de-DE', { maximumFractionDigits: decimals });
}

/**
 * Format a value for detail views with more nuanced decimal handling
 * Uses 0 decimals for >= 1000, otherwise uses provided decimals
 */
export function formatDetailValue(val: number | null | undefined, decimals: number = 1): string {
  if (val === null || val === undefined) return '–';
  if (val >= 1000) {
    return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  }
  return val.toLocaleString('de-DE', { maximumFractionDigits: decimals });
}

/**
 * Calculate percentage of part relative to total
 * Returns empty string if calculation isn't possible
 */
export function calcPercent(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0) {
    return '';
  }
  return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * Calculate percentage and return with parentheses for inline display
 * Used in hover cards where percentage is shown inline after a value
 */
export function calcPercentParens(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0) {
    return '';
  }
  return `(${((part / total) * 100).toFixed(1)}%)`;
}
