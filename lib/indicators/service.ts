/**
 * Indicator Data Service
 *
 * Handles loading and querying indicator data with caching.
 */

import type { IndicatorKey, SubMetricKey } from './types';
import { INDICATORS } from './types';

/**
 * Generic indicator data structure for Ausländer
 */
export interface AuslaenderDataset {
  meta: {
    source: string;
    description: string;
    geoLevel: string;
    unit: string;
    years: string[];
  };
  data: Record<string, Record<string, AuslaenderRecord>>; // year -> ags -> record
}

/**
 * Generic indicator data structure for Deutschlandatlas
 */
export interface DeutschlandatlasDataset {
  meta: {
    source: string;
    description: string;
    geoLevel: string;
    year: string;
    indicatorKeys: string[];
    categories: string[];
  };
  data: Record<string, DeutschlandatlasRecord>; // ags -> record
}

/**
 * Ausländer-specific record type
 */
export interface AuslaenderRecord {
  ags: string;
  name: string;
  regions: Record<string, {
    male: number | null;
    female: number | null;
    total: number | null;
  }>;
}

/**
 * Deutschlandatlas-specific record type
 */
export interface DeutschlandatlasRecord {
  ags: string;
  name: string;
  indicators: Record<string, number | null>;
}

/**
 * Service for loading and querying indicator data
 */
export class IndicatorDataService {
  private auslaenderCache: AuslaenderDataset | null = null;
  private deutschlandatlasCache: DeutschlandatlasDataset | null = null;

  /**
   * Load Ausländer indicator data
   */
  async loadAuslaender(): Promise<AuslaenderDataset> {
    if (this.auslaenderCache) {
      return this.auslaenderCache;
    }

    const module = await import('../data/indicators/auslaender.json');
    this.auslaenderCache = module.default as unknown as AuslaenderDataset;
    return this.auslaenderCache;
  }

  /**
   * Load Deutschlandatlas indicator data
   */
  async loadDeutschlandatlas(): Promise<DeutschlandatlasDataset> {
    if (this.deutschlandatlasCache) {
      return this.deutschlandatlasCache;
    }

    const module = await import('../data/indicators/deutschlandatlas.json');
    this.deutschlandatlasCache = module.default as unknown as DeutschlandatlasDataset;
    return this.deutschlandatlasCache;
  }

  /**
   * Get available years for an indicator
   */
  async getYears(key: IndicatorKey): Promise<string[]> {
    if (key === 'auslaender') {
      const dataset = await this.loadAuslaender();
      return dataset.meta.years;
    } else {
      const dataset = await this.loadDeutschlandatlas();
      return [dataset.meta.year];
    }
  }

  /**
   * Get a single value by AGS, year and sub-metric
   */
  async getValue(
    key: IndicatorKey,
    ags: string,
    year: string,
    subMetric: SubMetricKey
  ): Promise<number | null> {
    if (key === 'auslaender') {
      const dataset = await this.loadAuslaender();
      const record = dataset.data[year]?.[ags];
      if (!record) return null;
      return record.regions[subMetric]?.total ?? null;
    } else {
      const dataset = await this.loadDeutschlandatlas();
      const record = dataset.data[ags];
      if (!record) return null;
      return record.indicators[subMetric] ?? null;
    }
  }

  /**
   * Get all values for a year and sub-metric (for color scale calculation)
   */
  async getAllValues(
    key: IndicatorKey,
    year: string,
    subMetric: SubMetricKey
  ): Promise<{ ags: string; value: number }[]> {
    const values: { ags: string; value: number }[] = [];

    if (key === 'auslaender') {
      const dataset = await this.loadAuslaender();
      const yearData = dataset.data[year];
      if (!yearData) return [];

      for (const [ags, record] of Object.entries(yearData)) {
        const value = record.regions[subMetric]?.total;
        if (typeof value === 'number') {
          values.push({ ags, value });
        }
      }
    } else {
      const dataset = await this.loadDeutschlandatlas();
      for (const [ags, record] of Object.entries(dataset.data)) {
        const value = record.indicators[subMetric];
        if (typeof value === 'number') {
          values.push({ ags, value });
        }
      }
    }

    return values;
  }

  /**
   * Get the geographic level for an indicator
   */
  getGeoLevel(key: IndicatorKey): string {
    return INDICATORS[key].geoLevel;
  }

  /**
   * Check if indicator data is loaded
   */
  isLoaded(key: IndicatorKey): boolean {
    if (key === 'auslaender') {
      return this.auslaenderCache !== null;
    }
    return this.deutschlandatlasCache !== null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.auslaenderCache = null;
    this.deutschlandatlasCache = null;
  }
}

// Singleton instance
export const indicatorService = new IndicatorDataService();
