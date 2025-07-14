const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  // Load cookies from file
  const cookies = JSON.parse(fs.readFileSync('cookies.json'));
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto('https://wareconn.com/');

  console.log('Page loaded. You should be logged in!');
  // Keep browser open for inspection
})(); 