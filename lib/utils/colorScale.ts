import { scaleSequential, scaleDiverging, scaleLinear } from 'd3-scale';
import type { DistrictData, MetricKey, MetricConfig } from '../types/district';

/**
 * Custom color interpolator for diverging scales on dark backgrounds
 * Teal/Green (good/low) → neutral → Orange/Red (bad/high)
 */
function interpolateDivergingWarm(t: number): string {
  if (t < 0.5) {
    const ratio = t * 2;
    const r = Math.round(20 + ratio * 60);
    const g = Math.round(180 - ratio * 80);
    const b = Math.round(140 - ratio * 60);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const ratio = (t - 0.5) * 2;
    const r = Math.round(80 + ratio * 175);
    const g = Math.round(100 + ratio * 40);
    const b = Math.round(80 - ratio * 40);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Custom color interpolator for sequential scales on dark backgrounds
 */
function interpolateWarmSequential(t: number): string {
  const r = Math.round(40 + t * 215);
  const g = Math.round(50 + t * 120);
  const b = Math.round(70 - t * 30);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Bivariate color scale - creates colors based on two metrics
 *
 * Color scheme:
 *   - Both LOW: Teal (good on both)
 *   - Both HIGH: Magenta/Purple (concerning on both - strong correlation)
 *   - Metric A high, B low: Orange
 *   - Metric A low, B high: Blue
 */
function getBivariateColor(tA: number, tB: number): string {
  // tA and tB are both 0-1, where 0 = low, 1 = high

  // Create a 2D color space:
  // - Red channel: influenced by metric A
  // - Blue channel: influenced by metric B
  // - Green channel: high when both are similar (correlation)

  const avgValue = (tA + tB) / 2;
  const correlation = 1 - Math.abs(tA - tB); // How similar are the two values

  // Base colors for the four corners:
  // (0,0) = Teal:    rgb(20, 180, 160)  - both low
  // (1,1) = Magenta: rgb(220, 60, 180)  - both high (correlated)
  // (1,0) = Orange:  rgb(255, 140, 40)  - A high, B low
  // (0,1) = Blue:    rgb(60, 130, 220)  - A low, B high

  // Bilinear interpolation
  const r = Math.round(
    20 * (1-tA) * (1-tB) +   // teal
    255 * tA * (1-tB) +       // orange
    60 * (1-tA) * tB +        // blue
    220 * tA * tB             // magenta
  );

  const g = Math.round(
    180 * (1-tA) * (1-tB) +   // teal
    140 * tA * (1-tB) +       // orange
    130 * (1-tA) * tB +       // blue
    60 * tA * tB              // magenta
  );

  const b = Math.round(
    160 * (1-tA) * (1-tB) +   // teal
    40 * tA * (1-tB) +        // orange
    220 * (1-tA) * tB +       // blue
    180 * tA * tB             // magenta
  );

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Creates a color scale for the given metric and data.
 */
export function createColorScale(
  metric: MetricConfig,
  data: DistrictData[]
): (value: number | null) => string {
  const values = data
    .map((d) => d[metric.key as keyof DistrictData] as number | null)
    .filter((v): v is number => v !== null);

  if (values.length === 0) {
    return () => '#333333';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (metric.isDiverging) {
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    const scale = scaleDiverging<string>()
      .domain([-absMax, 0, absMax])
      .interpolator(interpolateDivergingWarm);

    return (value: number | null) => {
      if (value === null) return '#333333';
      return scale(value);
    };
  } else {
    const scale = scaleSequential<string>()
      .domain([min, max])
      .interpolator(interpolateWarmSequential);

    return (value: number | null) => {
      if (value === null) return '#333333';
      return scale(value);
    };
  }
}

/**
 * Creates a bivariate color scale for comparing two metrics
 */
export function createBivariateColorScale(
  metricA: MetricConfig,
  metricB: MetricConfig,
  data: DistrictData[]
): (districtId: string) => string {
  // Get values for both metrics
  const valuesA = data.map((d) => ({
    id: d.id,
    value: d[metricA.key as keyof DistrictData] as number | null
  }));

  const valuesB = data.map((d) => ({
    id: d.id,
    value: d[metricB.key as keyof DistrictData] as number | null
  }));

  // Calculate min/max for normalization
  const numbersA = valuesA.map(v => v.value).filter((v): v is number => v !== null);
  const numbersB = valuesB.map(v => v.value).filter((v): v is number => v !== null);

  if (numbersA.length === 0 || numbersB.length === 0) {
    return () => '#333333';
  }

  // For diverging metrics, normalize so 0 maps to 0.5
  // For sequential metrics, normalize min-max to 0-1
  const normalizeA = metricA.isDiverging
    ? (v: number) => {
        const absMax = Math.max(Math.abs(Math.min(...numbersA)), Math.abs(Math.max(...numbersA)));
        return (v / absMax + 1) / 2; // Maps -absMax..absMax to 0..1
      }
    : (v: number) => {
        const min = Math.min(...numbersA);
        const max = Math.max(...numbersA);
        return max === min ? 0.5 : (v - min) / (max - min);
      };

  const normalizeB = metricB.isDiverging
    ? (v: number) => {
        const absMax = Math.max(Math.abs(Math.min(...numbersB)), Math.abs(Math.max(...numbersB)));
        return (v / absMax + 1) / 2;
      }
    : (v: number) => {
        const min = Math.min(...numbersB);
        const max = Math.max(...numbersB);
        return max === min ? 0.5 : (v - min) / (max - min);
      };

  // Create lookup maps
  const mapA = new Map(valuesA.map(v => [v.id, v.value]));
  const mapB = new Map(valuesB.map(v => [v.id, v.value]));

  return (districtId: string) => {
    const valueA = mapA.get(districtId);
    const valueB = mapB.get(districtId);

    if (valueA === null || valueA === undefined || valueB === null || valueB === undefined) {
      return '#333333';
    }

    const tA = normalizeA(valueA);
    const tB = normalizeB(valueB);

    return getBivariateColor(tA, tB);
  };
}

/**
 * Calculate Pearson correlation coefficient between two metrics
 */
export function calculateCorrelation(
  metricA: MetricConfig,
  metricB: MetricConfig,
  data: DistrictData[]
): number | null {
  const pairs: { a: number; b: number }[] = [];

  for (const d of data) {
    const a = d[metricA.key as keyof DistrictData] as number | null;
    const b = d[metricB.key as keyof DistrictData] as number | null;
    if (a !== null && b !== null) {
      pairs.push({ a, b });
    }
  }

  if (pairs.length < 3) return null;

  const n = pairs.length;
  const sumA = pairs.reduce((s, p) => s + p.a, 0);
  const sumB = pairs.reduce((s, p) => s + p.b, 0);
  const sumAB = pairs.reduce((s, p) => s + p.a * p.b, 0);
  const sumA2 = pairs.reduce((s, p) => s + p.a * p.a, 0);
  const sumB2 = pairs.reduce((s, p) => s + p.b * p.b, 0);

  const numerator = n * sumAB - sumA * sumB;
  const denominator = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));

  if (denominator === 0) return null;

  return numerator / denominator;
}

/**
 * Generates legend stops for the color scale
 */
export function getLegendStops(
  metric: MetricConfig,
  data: DistrictData[],
  numStops: number = 5
): { value: number; color: string; label: string }[] {
  const values = data
    .map((d) => d[metric.key as keyof DistrictData] as number | null)
    .filter((v): v is number => v !== null);

  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const colorScale = createColorScale(metric, data);

  const stops: { value: number; color: string; label: string }[] = [];

  if (metric.isDiverging) {
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    const step = (2 * absMax) / (numStops - 1);

    for (let i = 0; i < numStops; i++) {
      const value = -absMax + i * step;
      stops.push({
        value,
        color: colorScale(value),
        label: metric.format(value),
      });
    }
  } else {
    const step = (max - min) / (numStops - 1);

    for (let i = 0; i < numStops; i++) {
      const value = min + i * step;
      stops.push({
        value,
        color: colorScale(value),
        label: metric.format(value),
      });
    }
  }

  return stops;
}

/**
 * Get bivariate legend colors for the 2x2 grid
 */
export function getBivariateLegendColors(): {
  lowLow: string;
  lowHigh: string;
  highLow: string;
  highHigh: string;
} {
  return {
    lowLow: getBivariateColor(0, 0),   // Teal - both low
    lowHigh: getBivariateColor(0, 1),  // Blue - A low, B high
    highLow: getBivariateColor(1, 0),  // Orange - A high, B low
    highHigh: getBivariateColor(1, 1), // Magenta - both high
  };
}
