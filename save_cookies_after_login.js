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
  const match = codePart.match(/(\d{3,})[^\d]*$/);
  if (match) {
    // Use last 3 digits as error code, prefixed with EC
    const errorCode = `EC${match[1].slice(-3)}`;
    return { errorCode, errorDescription: desc };
  } else {
    // Use the whole code part as error code
    return { errorCode: codePart.trim(), errorDescription: desc };
  }
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

(async () => {
  // Read the first serial from the batch file
  let serial = 'TEST123456';
  let part = '';
  let prefix = '';
  let lastStation = '';
  try {
    const batch = JSON.parse(fs.readFileSync('serial_batch_1.json'));
    if (batch.length > 0 && batch[0].serial_number) {
      serial = batch[0].serial_number;
      part = batch[0].part_number || '';
      prefix = batch[0].workstation_prefix || '';
      lastStation = batch[0].workstation_name || '';
    }
  } catch (e) {
    console.log('Could not read serial_batch_1.json, using test serial.');
  }

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
  console.log('When ready, press Enter here to check for the serial number field, enter the first serial, and save cookies...');
  process.stdin.once('data', async () => {
    await page.bringToFront();
    // Save cookies immediately after login/staging
    const cookies = await context.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    console.log('Cookies saved to cookies.json.');
    try {
      const input = await page.waitForSelector('[name="ppid"]', { timeout: 20000 });
      console.log("'[name=ppid]' input field found!");
      await input.fill(serial);
      await input.press('Enter');
      console.log(`Entered serial number '${serial}' and pressed Enter. Pausing for 5 seconds...`);
      await page.waitForTimeout(5000);

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
        await page.waitForTimeout(5000);
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
          await page.waitForTimeout(2000);
        } catch (e) {
          console.log("Error finding/navigating to 'Service Record' button:", e);
        }

        // --- Scrape the service record table ---
        let foundMatch = false;
        try {
          await page.waitForTimeout(2000); // Give the table a moment to load
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
            await page.waitForTimeout(2000); // Increased wait time
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
      // Optional: pause to observe
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log("'[name=ppid]' input field NOT found (timeout)");
      appendResult(OUTPUT_CSV, serial, part, 'Unknown', 'Unknown', lastStation);
    }
    await browser.close();
    process.exit(0);
  });
})(); 