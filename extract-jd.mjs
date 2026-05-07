import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto('https://englishjobsearch.ch/clickout/f8f6b542d9c73503', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Final URL:', page.url());
  const text = await page.locator('body').innerText();
  console.log(text);
  await browser.close();
})();
