import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Navigate to PDF
  await page.goto('https://latentworlds.ai/openings/senior_software_engineer_distributed_systems.pdf', { 
    waitUntil: 'networkidle', 
    timeout: 30000 
  });
  
  // Wait for PDF to render
  await page.waitForTimeout(3000);
  
  // Try to extract text from the PDF viewer
  const text = await page.evaluate(() => {
    // Try various PDF viewer text containers
    const selectors = [
      '#viewer .textLayer',
      '.textLayer',
      '#mainContainer .textLayer',
      '[class*="text"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText;
    }
    return document.body.innerText;
  });
  
  console.log(text);
  await browser.close();
})();
