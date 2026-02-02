import * as XLSX from 'xlsx';
import * as path from 'path';

const filePath = '/Users/alanozalp/Downloads/Daten_Sozialatlas_2025_0.xlsx';

const workbook = XLSX.readFile(filePath);

console.log('Sheet names:', workbook.SheetNames);
console.log('\n');

for (const sheetName of workbook.SheetNames) {
  console.log(`\n=== Sheet: ${sheetName} ===`);
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Show first 10 rows to understand structure
  console.log('First 10 rows:');
  data.slice(0, 10).forEach((row, i) => {
    console.log(`Row ${i}:`, row);
  });
  console.log('Total rows:', data.length);
}
