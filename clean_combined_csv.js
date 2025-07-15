const fs = require('fs');

const INPUT_FILE = 'wip_error_scraper_combined.csv';
const OUTPUT_FILE = 'wip_error_scraper_combined_clean.csv';

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`Input file ${INPUT_FILE} not found!`);
  process.exit(1);
}

const lines = fs.readFileSync(INPUT_FILE, 'utf8').split(/\r?\n/);
const cleaned = [];
let headerFound = false;
const serialPattern = /^"?\d{13}"?,/;

for (const line of lines) {
  if (!headerFound && line.toLowerCase().includes('serial')) {
    cleaned.push(line);
    headerFound = true;
    continue;
  }
  if (serialPattern.test(line)) {
    cleaned.push(line);
  }
}

fs.writeFileSync(OUTPUT_FILE, cleaned.join('\n'));
console.log(`Cleaned CSV written to ${OUTPUT_FILE}`);
console.log(`Original lines: ${lines.length}, Cleaned lines: ${cleaned.length}`); 