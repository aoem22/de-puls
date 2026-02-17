import type { CrimeCategory, WeaponType } from '@/lib/types/crime';

/**
 * PKS code → CrimeCategory mapping.
 * Ported from scripts/pipeline/push_to_supabase.py (PKS_TO_CATEGORY).
 */
const PKS_TO_CATEGORY: Record<string, CrimeCategory> = {
  // Violence
  '0100': 'murder',
  '0200': 'murder',
  '2110': 'murder',
  '2100': 'robbery',
  '2200': 'assault',
  '2340': 'assault',
  // Sexual
  '1100': 'sexual',
  '1110': 'sexual',
  '1300': 'sexual',
  // Theft / Burglary
  '3000': 'burglary',
  '4000': 'burglary',
  '4350': 'burglary',
  '4780': 'burglary',
  // Fraud
  '5100': 'fraud',
  // Property / Arson
  '6740': 'arson',
  '6750': 'vandalism',
  // Traffic
  '7100': 'traffic',
  '7200': 'traffic',
  '7300': 'traffic',
  '7400': 'traffic',
  // Drugs
  '8910': 'drugs',
  // Other violence
  '6200': 'assault',
  // Other
  '8990': 'other',
};

/**
 * Fallback: German pks_category name → CrimeCategory.
 * Ported from scripts/pipeline/push_to_supabase.py (GERMAN_TO_CATEGORY).
 */
const GERMAN_TO_CATEGORY: Record<string, CrimeCategory> = {
  'Mord': 'murder',
  'Tötungsdelikt': 'murder',
  'Raub': 'robbery',
  'Körperverletzung': 'assault',
  'Bedrohung': 'assault',
  'Sexualdelikt': 'sexual',
  'Diebstahl': 'burglary',
  'Wohnungseinbruch': 'burglary',
  'Kfz-Diebstahl': 'burglary',
  'Betrug': 'fraud',
  'Brandstiftung': 'arson',
  'Sachbeschädigung': 'vandalism',
  'Verkehrsunfall': 'traffic',
  'Fahrerflucht': 'traffic',
  'Trunkenheit': 'traffic',
  'Drogen': 'drugs',
  'Vermisst': 'missing_person',
  'Versammlung': 'other',
  'Verkehrskontrolle': 'traffic',
  'Sonstige': 'other',
};

/**
 * weapon_type → CrimeCategory mapping.
 * Maps details.weapon_type values to their corresponding filter categories.
 */
const WEAPON_TO_CATEGORY: Partial<Record<NonNullable<WeaponType>, CrimeCategory>> = {
  knife: 'knife',
  gun: 'weapons',
  blunt: 'weapons',
  explosive: 'weapons',
};

/**
 * Map an enriched article's crime + weapon_type fields to CrimeCategory[].
 * Returns all applicable categories (e.g. assault + knife for a knife assault).
 * Falls back to ['other'] if nothing maps.
 */
export function mapToCategories(
  crime?: { pks_code?: string; pks_category?: string },
  weaponType?: WeaponType,
): CrimeCategory[] {
  const cats = new Set<CrimeCategory>();

  if (crime) {
    if (crime.pks_code) {
      const mapped = PKS_TO_CATEGORY[crime.pks_code];
      if (mapped) cats.add(mapped);
    }
    if (crime.pks_category) {
      const mapped = GERMAN_TO_CATEGORY[crime.pks_category];
      if (mapped) cats.add(mapped);
    }
  }

  if (weaponType) {
    const mapped = WEAPON_TO_CATEGORY[weaponType];
    if (mapped) cats.add(mapped);
  }

  return cats.size > 0 ? [...cats] : ['other'];
}
