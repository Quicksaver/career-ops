import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import LinkedInScanner from '../scan-auth/linkedin.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

// Exercise the production click/extraction path against local DOM responses.
// No real LinkedIn requests, saved sessions, user files or workers are involved.
async function extract({ initialText = '', text = 'The selected posting job description.', delay = 0,
  destination = '102', switchAway = false } = {}) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({ contentType: 'text/html', body: '<main><button id="card">Selected job</button><span data-testid="expandable-text-box"></span></main>' });
    });
    await page.goto('https://www.linkedin.com/jobs/search-results/?currentJobId=101');
    await page.evaluate(({ initialText, text, delay, destination, switchAway }) => {
      const description = document.querySelector('[data-testid="expandable-text-box"]');
      description.textContent = initialText;
      document.querySelector('#card').onclick = () => {
        history.replaceState(null, '', `?currentJobId=${destination}`);
        setTimeout(() => {
          if (switchAway) history.replaceState(null, '', '?currentJobId=103');
          description.textContent = text;
        }, delay);
      };
    }, { initialText, text, delay, destination, switchAway });
    const waits = [];
    const wait = page.waitForFunction.bind(page);
    page.waitForFunction = (...args) => { waits.push(args[2]); return wait(...args); };
    const card = await page.$('#card');
    const result = await new LinkedInScanner().extractJob(page, card, { title: 'Selected job' });
    await card.dispose();
    assert.equal(requests, 1, 'loading must not navigate or fetch again');
    assert.deepEqual(waits, [{ timeout: 5000 }], 'one bounded same-page wait');
    assert.equal(result.jobId, destination);
    return result;
  } finally { await context.close(); }
}

test('a JD rendered after the old fixed sleep is captured automatically', async () => {
  const result = await extract({ delay: 1800 });
  assert.equal(result.jdText, 'The selected posting job description.');
  assert.equal(result.applicationUrl, 'https://www.linkedin.com/jobs/view/102/');
});

test('switching cards waits for replacement of the preceding posting description', async () => {
  const result = await extract({ initialText: 'The preceding posting description.', delay: 1800 });
  assert.equal(result.jdText, 'The selected posting job description.');
});

test('an already loaded description on the same selected card remains readable', async () => {
  const result = await extract({ initialText: 'Already loaded description.', text: 'Already loaded description.', destination: '101' });
  assert.equal(result.jdText, 'Already loaded description.');
});

test('a permanently empty JD exhausts the allowance and remains unavailable', async () => {
  const started = performance.now();
  const result = await extract({ text: '' });
  assert.equal(result.jdText, '');
  assert.ok(performance.now() - started >= 5000, 'do not declare unavailable before the loading allowance');
});

test('unchanged prior text never becomes the new posting JD', async () => {
  const result = await extract({ initialText: 'Old description.', text: 'Old description.' });
  assert.equal(result.jdText, '');
});

test('a description appearing after selection changes is not attributed to the prior job', async () => {
  const result = await extract({ delay: 1800, switchAway: true });
  assert.equal(result.jdText, '');
});
