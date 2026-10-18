import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import LinkedInScanner from '../scan-auth/linkedin.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const companySection = '<section><h2>About the company</h2><span data-testid="expandable-text-box">We are a relationship-driven recruitment partner. Company biography… more</span><button id="company-more"><span>more</span></button></section>';
const jobSection = '<section><h2>About the job</h2><span id="jd" data-testid="expandable-text-box"></span><button id="jd-more" hidden><span>more</span></button></section>';

// Exercise the production click/extraction path against local DOM responses.
// No real LinkedIn requests, saved sessions, user files or workers are involved.
async function extract({ initialText = '', text = 'The selected posting job description.', delay = 0,
  destination = '102', switchAway = false, html = companySection + jobSection, expandDelay = null } = {}) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let requests = 0;
    await page.route('**/*', route => {
      requests++;
      return route.fulfill({ contentType: 'text/html', body: `<main><button id="card">Selected job</button>${html}</main>` });
    });
    await page.goto('https://www.linkedin.com/jobs/search-results/?currentJobId=101');
    await page.evaluate(({ initialText, text, delay, destination, switchAway, expandDelay }) => {
      const description = document.querySelector('#jd');
      if (description) description.textContent = initialText;
      window.fixtureClicks = { company: 0, job: 0 };
      const companyMore = document.querySelector('#company-more');
      if (companyMore) companyMore.onclick = () => window.fixtureClicks.company++;
      const jobMore = document.querySelector('#jd-more');
      if (jobMore) jobMore.onclick = () => {
        window.fixtureClicks.job++;
        setTimeout(() => { description.textContent = text; jobMore.hidden = true; }, expandDelay);
      };
      document.querySelector('#card').onclick = () => {
        history.replaceState(null, '', `?currentJobId=${destination}`);
        setTimeout(() => {
          if (switchAway) history.replaceState(null, '', '?currentJobId=103');
          if (description) description.textContent = expandDelay === null ? text : 'Partial job introduction… more';
          if (jobMore && expandDelay !== null) jobMore.hidden = false;
        }, delay);
      };
    }, { initialText, text, delay, destination, switchAway, expandDelay });
    const waits = [];
    const wait = page.waitForFunction.bind(page);
    page.waitForFunction = (...args) => { waits.push(args[2]); return wait(...args); };
    const card = await page.$('#card');
    const result = await new LinkedInScanner().extractJob(page, card, { title: 'Selected job' });
    await card.dispose();
    assert.equal(requests, 1, 'loading must not navigate or fetch again');
    assert.deepEqual(waits, [{ timeout: 5000 }], 'one bounded same-page wait');
    assert.equal(result.jobId, destination);
    const clicks = await page.evaluate(() => window.fixtureClicks);
    assert.equal(clicks.company, 0, 'company expansion never belongs to the job extractor');
    assert.equal(clicks.job, expandDelay === null ? 0 : 1, 'the job expansion is clicked at most once');
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

test('a populated company biography cannot satisfy job-description readiness', async () => {
  const result = await extract({ text: '' });
  assert.equal(result.jdText, '');
});

test('only a company biography or an unscoped expandable box remains unavailable', async () => {
  for (const html of [companySection, '<span id="jd" data-testid="expandable-text-box"></span>']) {
    assert.equal((await extract({ html })).jdText, '');
  }
});

test('the job expansion waits for delayed full text and never saves the teaser', async () => {
  const result = await extract({ expandDelay: 900 });
  assert.equal(result.jdText, 'The selected posting job description.');
});

test('LinkedIn visually rendered aria-hidden expansion buttons remain clickable', async () => {
  const html = companySection + jobSection.replace('id="jd-more"', 'id="jd-more" data-testid="expandable-text-button" aria-hidden="true"');
  assert.equal((await extract({ html, expandDelay: 200 })).jdText, 'The selected posting job description.');
});

test('an aria-hidden job panel cannot use the expansion-button exception', async () => {
  const html = companySection + jobSection.replace('<section>', '<section aria-hidden="true">')
    .replace('id="jd-more"', 'id="jd-more" data-testid="expandable-text-button" aria-hidden="true"');
  assert.equal((await extract({ html })).jdText, '');
});

test('an expanded button child span cannot request expansion again', async () => {
  const html = companySection + jobSection.replace('id="jd-more" hidden', 'id="expanded" aria-expanded="true"');
  assert.equal((await extract({ html })).jdText, 'The selected posting job description.');
});

test('an expansion which never finishes leaves the JD unavailable', async () => {
  const result = await extract({ expandDelay: 10000 });
  assert.equal(result.jdText, '');
});

test('a truncated JD without its own expansion control is not saved', async () => {
  const result = await extract({ text: 'Partial job introduction… more' });
  assert.equal(result.jdText, '');
});

test('legacy job containers scope their sibling expansion control', async () => {
  const html = companySection + '<section class="jobs-description"><h2>Job description</h2><div id="job-details"><span id="jd" data-testid="expandable-text-box"></span></div><button id="jd-more" hidden>Show more</button></section>';
  assert.equal((await extract({ html, expandDelay: 500 })).jdText, 'The selected posting job description.');
});

test('a job heading in a separate wrapper cannot expand the preceding company section', async () => {
  const html = `<div>${companySection}<header><h2>About the job</h2></header><div><span id="jd" data-testid="expandable-text-box"></span><button id="jd-more" hidden>more</button></div></div>`;
  assert.equal((await extract({ html, expandDelay: 500 })).jdText, 'The selected posting job description.');
});

test('a hidden legacy description cannot replace the visible modern job section', async () => {
  const html = '<section hidden><div id="job-details">Hidden previous description.</div></section>' + companySection + jobSection;
  assert.equal((await extract({ html })).jdText, 'The selected posting job description.');
});

test('multiple visible job sections remain ambiguous instead of choosing DOM order', async () => {
  const html = companySection + jobSection + '<section><h2>About the job</h2><span data-testid="expandable-text-box">Another posting description.</span></section>';
  assert.equal((await extract({ html })).jdText, '');
});

test('a Portuguese job heading still separates the JD from company information', async () => {
  assert.equal((await extract({ html: companySection + jobSection.replace('About the job', 'Sobre a vaga') })).jdText, 'The selected posting job description.');
});

test('an ordinary more link in the job section is not an expansion control', async () => {
  const html = companySection + jobSection.replace('</section>', '<a href="https://employer.example.org/more"><span>more</span></a></section>');
  assert.equal((await extract({ html })).jdText, 'The selected posting job description.');
});
