const xlsx = require('xlsx');
const fs = require('fs');

const EXCEL_PATH = 'WipOutputReport.xlsx';
const OUTPUT_PATH = 'serial_batch_1.json';

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

// Build batch list (only first two for trial)
const batch = unique.slice(0, 2).map(row => ({
  serial_number: row['SN'],
  part_number: row['PN'] || '',
  workstation_name: row['Workstation Name'],
  workstation_prefix: getPrefix(row['Workstation Name']),
  history_station_start_time: String(row['History station start time'])
}));

// Write to JSON file
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(batch, null, 2));

console.log(`Wrote ${batch.length} serials to ${OUTPUT_PATH}`); 