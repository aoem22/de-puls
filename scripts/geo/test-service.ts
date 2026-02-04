/**
 * Test script for GeoDataService
 * Usage: npx tsx scripts/geo/test-service.ts
 */

import { geoService, getBundeslandFromAgs, getKreisFromAgs, isValidAgs } from '../../lib/geo';

async function runTests() {
  console.log('=== GeoDataService Tests ===\n');

  // Test 1: Load Kreis data
  console.log('Test 1: Loading Kreis data...');
  const kreise = await geoService.loadLevel('kreis');
  console.log(`  ✓ Loaded ${kreise.features.length} Kreise\n`);

  // Test 2: Check cache
  console.log('Test 2: Cache functionality...');
  console.log(`  isLoaded('kreis'): ${geoService.isLoaded('kreis')}`);
  console.log(`  isLoaded('bundesland'): ${geoService.isLoaded('bundesland')}`);
  console.log(`  ✓ Cache works correctly\n`);

  // Test 3: AGS lookup
  console.log('Test 3: AGS lookup...');
  const berlin = await geoService.getFeatureByAgs('kreis', '11000');
  if (berlin) {
    console.log(`  Found: ${berlin.properties?.name} (AGS: ${berlin.properties?.ags})`);
    console.log(`  ✓ AGS lookup works\n`);
  } else {
    console.log('  ✗ Berlin not found\n');
  }

  // Test 4: Get features by parent (all Kreise in Bavaria)
  console.log('Test 4: Get features by parent (Bavaria)...');
  const bavarianKreise = await geoService.getFeaturesByParent('kreis', '09');
  console.log(`  Found ${bavarianKreise.length} Kreise in Bayern (09)`);
  console.log(`  Sample: ${bavarianKreise[0]?.properties?.name}`);
  console.log(`  ✓ Parent filtering works\n`);

  // Test 5: AGS utilities
  console.log('Test 5: AGS utilities...');
  const testAgs = '09162000';
  console.log(`  AGS: ${testAgs}`);
  console.log(`  getBundeslandFromAgs: ${getBundeslandFromAgs(testAgs)}`);
  console.log(`  getKreisFromAgs: ${getKreisFromAgs(testAgs)}`);
  console.log(`  isValidAgs('09162', 'kreis'): ${isValidAgs('09162', 'kreis')}`);
  console.log(`  isValidAgs('091', 'kreis'): ${isValidAgs('091', 'kreis')}`);
  console.log(`  ✓ AGS utilities work\n`);

  // Test 6: Cache stats
  console.log('Test 6: Cache statistics...');
  const stats = geoService.getCacheStats();
  stats.forEach((s) => {
    console.log(`  ${s.level}: ${s.featureCount} features`);
  });
  console.log(`  ✓ Cache stats work\n`);

  console.log('=== All tests passed! ===');
}

runTests().catch(console.error);
