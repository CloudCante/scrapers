const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = 'wip_error_scraper_combined.csv';
const BATCH_PATTERN = /^output_batch\d+\.csv$/;

// Find all batch CSV files in the current directory
const files = fs.readdirSync('.').filter(f => BATCH_PATTERN.test(f));
if (files.length === 0) {
  console.error('No batch CSV files found!');
  process.exit(1);
}

let header = null;
let allRows = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) continue;
  if (!header) {
    header = lines[0];
    allRows.push(header);
  }
  // Add all lines except header
  for (let i = 1; i < lines.length; i++) {
    allRows.push(lines[i]);
  }
  console.log(`Read ${lines.length - 1} rows from ${file}`);
}

fs.writeFileSync(OUTPUT_FILE, allRows.join('\n'));
console.log(`Combined ${files.length} batch CSVs into ${OUTPUT_FILE}`);
console.log(`Total rows (including header): ${allRows.length}`); 