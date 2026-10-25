// The tailored CV belongs to one application report (#5439). Upstream names it
// cv-{candidate}-{report}; this fork names every artifact after the report as
// {REPORT_NUM}-{company-slug}-{date} (FORK.md "CV Output Naming"), which keeps
// two same-company reports apart the same way. Both checks below hold for the
// fork's names: two reports never share a CV, and the printed PDF command
// passes the paths through a POSIX shell literally.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pass, fail, getBash } from './helpers.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const pdfCommand = (stdout) => stdout.split('\n').find(line => line.trim().startsWith('node generate-pdf.mjs '))?.trim();

check('tailoring two same-company reports retains both application-specific CVs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tailor-report-identity-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'config/profile.yml'), 'name: Jane Doe\n');
    writeFileSync(join(root, 'cv.md'), '# Jane Doe\nVerified experience.\n');
    const jd = join(root, 'jd.txt');
    writeFileSync(jd, 'A local test posting.');
    const stub = join(root, 'endpoint.cjs');
    writeFileSync(stub, `globalThis.fetch = async (url) => {
      if (String(url) !== 'http://127.0.0.1:7777/v1/chat/completions') throw new Error('Unexpected network request');
      return { ok: true, json: async () => ({ choices: [{ message: { content: process.env.TEST_TAILORED_HTML } }] }) };
    };`);
    const outputs = [];
    for (const number of ['001', '002']) {
      const report = join(root, 'reports', number + '-acme-2026-01-01.md');
      writeFileSync(report, '# Evaluation: Acme — Engineer\n\nTwo different requisitions.');
      const html = `<html><body>Verified CV for application ${number}</body></html>`;
      const result = spawnSync(process.execPath, ['--require', stub, 'openai-tailor.mjs', '--jd', jd, '--report', report, '--url', 'http://127.0.0.1:7777/v1', '--model', 'local-fixture'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_USER: 'tailor-fixture', CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', OPENAI_API_KEY: '', TEST_TAILORED_HTML: html },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const path = result.stdout.match(/Tailored HTML saved: (.+)/)?.[1]?.trim();
      assert.ok(path, result.stdout);
      assert.equal(basename(path), `${number}-acme-2026-01-01.html`);
      outputs.push({ path, html, nextPdf: pdfCommand(result.stdout) });
    }
    assert.notEqual(outputs[0].path, outputs[1].path, 'second report overwrote the first report CV');
    assert.notEqual(outputs[0].nextPdf, outputs[1].nextPdf, 'the suggested PDF outputs collide');
    assert.equal(readdirSync(join(root, 'output')).filter(name => name.endsWith('.html')).length, 2);
    for (const output of outputs) assert.equal(readFileSync(output.path, 'utf8'), output.html);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const reportFilename of [
  '003-acme senior engineer.md',
  "003-acme team's report.md",
  '003-acme-$TEST_REPORT_FRAGMENT-$(printf injected)-`printf extra`;report.md',
]) {
  check(`the suggested PDF command preserves literal report paths: ${reportFilename}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'tailor-pdf-command-'));
    try {
      mkdirSync(join(root, 'config'));
      mkdirSync(join(root, 'reports'));
      writeFileSync(join(root, 'config/profile.yml'), 'name: Jane Doe\n');
      writeFileSync(join(root, 'cv.md'), '# Jane Doe\nVerified experience.\n');
      const jd = join(root, 'jd.txt');
      const report = join(root, 'reports', reportFilename);
      writeFileSync(jd, 'A local test posting.');
      writeFileSync(report, '# Evaluation: Acme — Engineer\n');
      const stub = join(root, 'endpoint.cjs');
      writeFileSync(stub, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '<html><body>Verified CV</body></html>' } }] }) });`);
      const result = spawnSync(process.execPath, ['--require', stub, 'openai-tailor.mjs', '--jd', jd, '--report', report, '--url', 'http://127.0.0.1:7777/v1', '--model', 'local-fixture'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_USER: 'tailor-fixture', CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', OPENAI_API_KEY: '' },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const htmlPath = result.stdout.match(/Tailored HTML saved: (.+)/)?.[1]?.trim();
      assert.ok(htmlPath, result.stdout);
      // The report number survives a name outside the canonical shape, and the
      // slug carries no shell metacharacters from it.
      assert.match(basename(htmlPath), /^003-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/);
      const command = pdfCommand(result.stdout);
      assert.ok(command, result.stdout);
      writeFileSync(join(root, 'generate-pdf.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
      const pdf = spawnSync(getBash(), ['-c', command], {
        cwd: root, encoding: 'utf8', env: { ...process.env, TEST_REPORT_FRAGMENT: 'expanded' },
      });
      assert.equal(pdf.error, undefined);
      assert.equal(pdf.status, 0, pdf.stdout + pdf.stderr);
      assert.deepEqual(JSON.parse(pdf.stdout.trim()),
        ['--user', 'tailor-fixture', htmlPath, htmlPath.replace(/\.html$/, '.pdf'), '--format=letter', '--report=003']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
