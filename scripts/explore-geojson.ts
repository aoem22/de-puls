async function main() {
  const response = await fetch('https://opendata.darmstadt.de/sites/default/files/DA_ST_Bezirke.geojson');
  const geojson = await response.json();

  console.log('GeoJSON type:', geojson.type);
  console.log('Total features:', geojson.features.length);
  console.log('\nFeature properties:');

  geojson.features.forEach((f: any, i: number) => {
    console.log(`Feature ${i}:`, JSON.stringify(f.properties));
  });

  // Check CRS
  console.log('\nCRS:', geojson.crs);

  // Sample coordinate to check format
  const firstCoord = geojson.features[0].geometry.coordinates[0][0][0];
  console.log('\nSample coordinate:', firstCoord);
}

main().catch(console.error);
