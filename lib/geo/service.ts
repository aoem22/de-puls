import type { FeatureCollection, Feature } from 'geojson';
import type { GeoLevel, GeoFeatureProps } from './types';

/**
 * Filename mapping for each geographic level
 * Files are stored in lib/data/geo/
 */
const FILE_NAMES: Record<GeoLevel, string> = {
  bundesland: 'bundeslaender',
  kreis: 'kreise',
  gemeindeverband: 'gemeindeverbaende',
  gemeinde: 'gemeinden',
  city: 'cities', // City-level crime data uses point geometries
  point: 'blaulicht-crimes', // Point-based police reports
};

/**
 * Service for loading and querying geographic boundary data
 *
 * Features:
 * - Lazy loading with caching
 * - O(1) AGS lookups via index
 * - Code splitting via dynamic imports
 */
export class GeoDataService {
  private cache = new Map<GeoLevel, FeatureCollection>();
  private indexes = new Map<GeoLevel, Map<string, Feature>>();

  /**
   * Load geographic data for a specific level
   * Data is cached after first load
   */
  async loadLevel(level: GeoLevel): Promise<FeatureCollection> {
    if (this.cache.has(level)) {
      return this.cache.get(level)!;
    }

    // Dynamic import for code splitting
    const filename = FILE_NAMES[level];
    const module = await import(`../data/geo/${filename}.json`);
    const fc = module.default as FeatureCollection;

    this.cache.set(level, fc);

    // Build AGS index for O(1) lookups
    const index = new Map<string, Feature>();
    for (const feature of fc.features) {
      const props = feature.properties as GeoFeatureProps;
      index.set(props.ags, feature);
    }
    this.indexes.set(level, index);

    return fc;
  }

  /**
   * Get a single feature by AGS code
   * Returns null if not found
   */
  async getFeatureByAgs(level: GeoLevel, ags: string): Promise<Feature | null> {
    await this.loadLevel(level);
    return this.indexes.get(level)?.get(ags) ?? null;
  }

  /**
   * Get all features for a geographic level
   */
  async getAllFeatures(level: GeoLevel): Promise<Feature[]> {
    const fc = await this.loadLevel(level);
    return fc.features;
  }

  /**
   * Get features filtered by parent AGS (e.g., all Kreise in a Bundesland)
   */
  async getFeaturesByParent(
    level: GeoLevel,
    parentAgs: string
  ): Promise<Feature[]> {
    const fc = await this.loadLevel(level);
    return fc.features.filter((feature) => {
      const props = feature.properties as GeoFeatureProps;
      return props.ags.startsWith(parentAgs);
    });
  }

  /**
   * Check if a level's data is already loaded
   */
  isLoaded(level: GeoLevel): boolean {
    return this.cache.has(level);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { level: GeoLevel; featureCount: number }[] {
    return Array.from(this.cache.entries()).map(([level, fc]) => ({
      level,
      featureCount: fc.features.length,
    }));
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    this.indexes.clear();
  }
}

// Singleton instance for application-wide use
export const geoService = new GeoDataService();
