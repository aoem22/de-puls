#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Populate geo_boundaries table with Kreis-level entries from kreise.json.
 * Computes bounding boxes from polygon geometry.
 *
 * Usage: node scripts/populate_geo_boundaries.js
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function computeBbox(geometry) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

  function processCoords(coords) {
    if (typeof coords[0] === 'number') {
      // [lon, lat] point
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords) processCoords(c);
    }
  }

  processCoords(geometry.coordinates);
  return [minLon, minLat, maxLon, maxLat];
}

async function main() {
  const kreisePath = path.join(__dirname, '..', 'lib', 'data', 'geo', 'kreise.json');
  const data = JSON.parse(fs.readFileSync(kreisePath, 'utf-8'));

  console.log(`Processing ${data.features.length} features...`);

  const rows = data.features.map((feat) => {
    const { ags, name, bundesland } = feat.properties;
    const bbox = computeBbox(feat.geometry);
    return {
      level: 'kreis',
      ags,
      name,
      bundesland,
      geometry: feat.geometry,
      properties: feat.properties,
      bbox,
      source: 'kreise.json',
      source_dataset: 'geo/kreise',
    };
  });

  // Insert in batches of 50
  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('geo_boundaries').upsert(batch, {
      onConflict: 'ags,level',
    });

    if (error) {
      // If upsert fails (no unique constraint on ags+level), try insert
      console.log(`Upsert failed, trying insert: ${error.message}`);
      const { error: insertError } = await supabase.from('geo_boundaries').insert(batch);
      if (insertError) {
        console.error(`Insert failed for batch ${i}: ${insertError.message}`);
        continue;
      }
    }

    inserted += batch.length;
    process.stdout.write(`\r  Inserted ${inserted}/${rows.length}`);
  }

  console.log(`\nDone. Inserted ${inserted} geo_boundaries rows.`);

  // Verify
  const { count } = await supabase.from('geo_boundaries').select('*', { count: 'exact', head: true }).eq('level', 'kreis');
  console.log(`Verification: ${count} kreis-level rows in geo_boundaries`);
}

main().catch(console.error);
