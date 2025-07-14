const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // 1. Launch browser and open login page
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://wareconn.com/Login');

  // 2. Wait for manual login
  console.log('Please log in manually in the browser window.');
  console.log('After you are logged in, press Enter here to continue...');
  process.stdin.once('data', async () => {
    // 3. Save cookies
    const cookies = await context.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    console.log('Cookies saved! Opening a new window with the same session...');

    // 4. Open a new context and inject cookies
    const context2 = await browser.newContext();
    const cookiesFromFile = JSON.parse(fs.readFileSync('cookies.json'));
    await context2.addCookies(cookiesFromFile);

    // 5. Open new page and navigate to wareconn.com
    const page2 = await context2.newPage();
    await page2.goto('https://wareconn.com/');

    console.log('New window opened. You should be logged in!');
    // Keep browser open for inspection
  });
})();
