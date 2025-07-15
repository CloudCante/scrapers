const xlsx = require('xlsx');
const fs = require('fs');

const EXCEL_PATH = 'WipOutputReport.xlsx';
const BATCH_COUNT = 8;
const BATCH_SIZE = 500;

// Read Excel
const workbook = xlsx.readFile(EXCEL_PATH);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet);

// Filter for Workstation Name containing 'REPAIR'
const filtered = data.filter(row =>
  String(row['Workstation Name'] || '').toUpperCase().includes('REPAIR')
);

// Clean serial numbers
filtered.forEach(row => {
  row['SN'] = String(row['SN'] || '').trim().toUpperCase();
});

// Sort and deduplicate by SN (most recent)
filtered.sort((a, b) => {
  if (a['SN'] < b['SN']) return -1;
  if (a['SN'] > b['SN']) return 1;
  // Descending by date
  return new Date(b['History station start time']) - new Date(a['History station start time']);
});
const seen = new Set();
const unique = [];
for (const row of filtered) {
  if (!seen.has(row['SN'])) {
    seen.add(row['SN']);
    unique.push(row);
  }
}

// Get prefix from Workstation Name
function getPrefix(wsName) {
  return typeof wsName === 'string' && wsName.includes('_')
    ? wsName.split('_')[0]
    : wsName || '';
}

// Build all serials
const allSerials = unique.map(row => ({
  serial_number: row['SN'],
  part_number: row['PN'] || '',
  workstation_name: row['Workstation Name'],
  workstation_prefix: getPrefix(row['Workstation Name']),
  history_station_start_time: String(row['History station start time'])
}));

// Split into 8 batches
const total = allSerials.length;
const batches = [];
for (let i = 0; i < BATCH_COUNT; i++) {
  const start = i * BATCH_SIZE;
  const end = start + BATCH_SIZE;
  batches.push(allSerials.slice(start, end));
}

// Write to JSON files and print summary
console.log(`Created ${BATCH_COUNT} batch files:`);
let totalInBatches = 0;
for (let i = 0; i < BATCH_COUNT; i++) {
  const batchPath = `serial_batch_${i + 1}.json`;
  fs.writeFileSync(batchPath, JSON.stringify(batches[i], null, 2));
  totalInBatches += batches[i].length;
  console.log(`${batchPath}: ${batches[i].length} serials`);
  // Show preview
  if (batches[i].length > 0) {
    console.log(`  Preview (first 3):`);
    batches[i].slice(0, 3).forEach((item, j) => {
      console.log(`    ${j + 1}. ${item.serial_number} - ${item.workstation_name}`);
    });
  }
}
console.log(`Total serials processed: ${totalInBatches}`); 