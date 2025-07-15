const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configurable output CSV file
const OUTPUT_CSV = process.argv[2] || 'output_batch1.csv';

// Function to clean station name
function cleanStationName(raw) {
  // Remove any '【number】' or similar, then trim and uppercase
  return (raw || '').replace(/【\d+】/g, '').replace(/\s+/g, '').toUpperCase();
}

// Function to parse error code and description
function parseErrorCodeAndDescription(reasonField) {
  if (typeof reasonField !== 'string' || !reasonField.includes(':')) {
    return { errorCode: 'Unknown', errorDescription: 'Unknown' };
  }
  const [codePart, ...descParts] = reasonField.split(':');
  const desc = descParts.join(':').trim();
  
  // Check if it follows the error code pattern: numbers_numbers (no letters)
  const errorPattern = /^\d+_\d+$/;
  const hasLetters = /[a-zA-Z]/;
  
  if (errorPattern.test(codePart) && !hasLetters.test(codePart)) {
    // It's an error code: extract last 3 digits and prefix with EC
    const match = codePart.match(/(\d{3,})[^\d]*$/);
    if (match) {
      const errorCode = `EC${match[1].slice(-3)}`;
      return { errorCode, errorDescription: desc };
    }
  }
  
  // It's a failure code: use the whole code part as-is
  return { errorCode: codePart.trim(), errorDescription: desc };
}

// Function to append a result to CSV
function appendResult(csvPath, serial, part, errorCode, errorDescription, lastStation) {
  // Write header if file does not exist
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'Serial Number,Part Number,Error Code,Error Description,Last Station Known\n');
  }
  const row = `"${serial}","${part}","${errorCode}","${errorDescription}","${lastStation}"\n`;
  fs.appendFileSync(csvPath, row);
}

// Function to check if a serial has already been processed
function isAlreadyProcessed(csvPath, serial) {
  if (!fs.existsSync(csvPath)) return false;
  const content = fs.readFileSync(csvPath, 'utf8');
  return content.includes(`"${serial}"`);
}

// Function to process a single serial
async function processSerial(page, serial, part, prefix, lastStation) {
  console.log(`\n--- Processing Serial: ${serial} ---`);
  
  try {
    // Navigate back to the main page for each serial
    await page.goto('https://wareconn.com/r/Summary/pctls');
    await page.waitForTimeout(2000);

    const input = await page.waitForSelector('[name="ppid"]', { timeout: 20000 });
    console.log(`Found input field for serial: ${serial}`);
          await input.fill(serial);
      await input.press('Enter');
      console.log(`Entered serial number '${serial}' and pressed Enter. Pausing for 8 seconds...`);
      await page.waitForTimeout(8000);

    // Find all eyeball links
    const eyeballLinks = await page.$$('a:has(i.fa-eye)');
    const hrefs = [];
    for (const link of eyeballLinks) {
      const href = await link.getAttribute('href');
      hrefs.push(href);
    }
    console.log('Detected eyeball links:', hrefs);
    
    if (hrefs.length > 0) {
      const baseUrl = page.url();
      const eyeballUrl = hrefs[0].startsWith('http') ? hrefs[0] : new URL(hrefs[0], baseUrl).href;
              console.log('Navigating directly to:', eyeballUrl);
        await page.goto(eyeballUrl);

        // Wait for the Service Record button to load
        await page.waitForTimeout(8000);
      try {
        await page.waitForSelector('a.btn-info:has-text("Service Record")', { timeout: 10000 });
        const serviceRecordLink = await page.$('a.btn-info:has-text("Service Record")');
        if (serviceRecordLink) {
          const href = await serviceRecordLink.getAttribute('href');
          const baseUrl2 = page.url();
          const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl2).href;
          console.log("Navigating directly to Service Record:", fullUrl);
          await page.goto(fullUrl);
                  } else {
            console.log("'Service Record' button not found.");
          }
          await page.waitForTimeout(3000);
      } catch (e) {
        console.log("Error finding/navigating to 'Service Record' button:", e);
      }

              // --- Scrape the service record table ---
        let foundMatch = false;
        try {
          await page.waitForTimeout(3000); // Give the table a moment to load
        await page.waitForSelector('table.table-striped', { timeout: 10000 });
      } catch (e) {
        console.log('Table not found! Logging page content for debugging...');
        const bodyHtml = await page.content();
        console.log(bodyHtml.slice(0, 2000)); // Log first 2000 chars
        throw e;
      }
      
      const rows = await page.$$('table.table-striped tr');
      for (const row of rows) {
        const tds = await row.$$('td');
        if (tds.length < 4) continue;
        const stationRaw = await tds[0].innerText();
        const station = cleanStationName(stationRaw);
        const status = (await tds[2].innerText()).trim().toLowerCase();
                  if (station === prefix.toUpperCase() && status === 'fail') {
            // Click the Reason cell to expand
            await tds[3].click();
            await page.waitForTimeout(3000); // Increased wait time
          const reason = (await tds[3].innerText()).trim();
          let errorCode = 'Unknown';
          let errorDescription = 'Unknown';
          if (station && status && reason) {
            const parsed = parseErrorCodeAndDescription(reason);
            errorCode = parsed.errorCode;
            errorDescription = parsed.errorDescription;
          }
          console.log(`[SCRAPED] station: '${station}', status: '${status}', reason: '${reason}'`);
          console.log(`[PARSED] errorCode: '${errorCode}', errorDescription: '${errorDescription}'`);
          appendResult(OUTPUT_CSV, serial, part, errorCode, errorDescription, lastStation);
          foundMatch = true;
          break; // Only first match
        }
      }
      if (!foundMatch) {
        console.log(`[PARSED] errorCode: 'Unknown', errorDescription: 'Unknown'`);
        appendResult(OUTPUT_CSV, serial, part, 'Unknown', 'Unknown', lastStation);
      }
    } else {
      console.log('No eyeball links found.');
      appendResult(OUTPUT_CSV, serial, part, 'Unknown', 'Unknown', lastStation);
    }
    
    console.log(`--- Completed Serial: ${serial} ---`);
    return true; // Success
    
  } catch (e) {
    console.log(`Error processing serial ${serial}:`, e.message);
    appendResult(OUTPUT_CSV, serial, part, 'Error', `Processing failed: ${e.message}`, lastStation);
    return false; // Failed
  }
}

(async () => {
  // Read all serials from the batch file
  let batch = [];
  try {
    batch = JSON.parse(fs.readFileSync('serial_batch_1.json'));
    console.log(`Loaded ${batch.length} serials from batch file`);
  } catch (e) {
    console.log('Could not read serial_batch_1.json, using test serial.');
    batch = [{
      serial_number: 'TEST123456',
      part_number: '',
      workstation_prefix: '',
      workstation_name: ''
    }];
  }

  // Filter out already processed serials
  const unprocessedSerials = batch.filter(item => 
    !isAlreadyProcessed(OUTPUT_CSV, item.serial_number)
  );

  if (unprocessedSerials.length === 0) {
    console.log('All serials have already been processed!');
    process.exit(0);
  }

  console.log(`Found ${unprocessedSerials.length} unprocessed serials out of ${batch.length} total`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({
    viewport: null // Use the full available screen
  });
  const page = await context.newPage();
  await page.goto('https://wareconn.com/r/Summary/pctls');

  // Try to maximize the window (for some platforms)
  try {
    await page.evaluate(() => {
      window.moveTo(0, 0);
      window.resizeTo(screen.width, screen.height);
    });
  } catch (e) {}

  console.log('Please log in and stage the area in the browser window.');
  console.log('When ready, press Enter here to start processing serials...');
  process.stdin.once('data', async () => {
    await page.bringToFront();
    // Save cookies immediately after login/staging
    const cookies = await context.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    console.log('Cookies saved to cookies.json.');

    // Process each unprocessed serial
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < unprocessedSerials.length; i++) {
      const item = unprocessedSerials[i];
      console.log(`\nProcessing ${i + 1}/${unprocessedSerials.length}: ${item.serial_number}`);
      
      const success = await processSerial(
        page, 
        item.serial_number, 
        item.part_number || '', 
        item.workstation_prefix || '', 
        item.workstation_name || ''
      );
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
      // Small pause between serials
      if (i < unprocessedSerials.length - 1) {
        console.log('Pausing 5 seconds before next serial...');
        await page.waitForTimeout(5000);
      }
    }

    console.log(`\n=== PROCESSING COMPLETE ===`);
    console.log(`Successfully processed: ${successCount}`);
    console.log(`Failed to process: ${failCount}`);
    console.log(`Total processed: ${successCount + failCount}`);
    
    await browser.close();
    process.exit(0);
  });
})(); 