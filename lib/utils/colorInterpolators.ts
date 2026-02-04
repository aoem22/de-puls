/**
 * Custom color interpolation functions for choropleth maps
 * These create visually distinct gradients optimized for dark map backgrounds
 */

/**
 * Interpolate color for crime rate (Häufigkeitszahl)
 * Creates a warm yellow-to-red gradient
 * t: 0 = low crime (yellow/amber), t: 1 = high crime (dark red)
 */
export function interpolateCrimeRate(t: number): string {
  if (t < 0.5) {
    const ratio = t * 2;
    const r = Math.round(255);
    const g = Math.round(235 - ratio * 100);
    const b = Math.round(100 - ratio * 60);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const ratio = (t - 0.5) * 2;
    const r = Math.round(255 - ratio * 40);
    const g = Math.round(135 - ratio * 95);
    const b = Math.round(40 - ratio * 20);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Interpolate color for clearance rate (Aufklärungsquote)
 * Creates a red-to-green gradient where higher (better) is green
 * t: 0 = low clearance (red), t: 1 = high clearance (green)
 */
export function interpolateClearanceRate(t: number): string {
  if (t < 0.5) {
    const ratio = t * 2;
    const r = Math.round(220 - ratio * 20);
    const g = Math.round(60 + ratio * 160);
    const b = Math.round(60);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const ratio = (t - 0.5) * 2;
    const r = Math.round(200 - ratio * 150);
    const g = Math.round(220 - ratio * 40);
    const b = Math.round(60 + ratio * 40);
    return `rgb(${r}, ${g}, ${b})`;
  }
}
