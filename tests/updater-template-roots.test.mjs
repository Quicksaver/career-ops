import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredTemplateDataRoots, snapshotConfiguredTemplateVariants } from '../update-system.mjs';

test('updates preserve configured templates in the checkout for multiple independent user profiles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-template-roots-'));
  const systemRoot = join(dir, 'system');
  const users = join(systemRoot, 'users');
  const external = join(dir, 'external');
  try {
    for (const root of [join(users, 'fictional-a'), join(users, 'fictional-b'), external]) mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(users, 'fictional-a/config/profile.yml'), 'cv:\n  template: variant-a\n');
    writeFileSync(join(users, 'fictional-b/config/profile.yml'), 'cv:\n  template: variant-b\n');
    writeFileSync(join(external, 'config/profile.yml'), 'cover_letter:\n  template: external-cover\n');
    mkdirSync(join(systemRoot, 'templates'), { recursive: true });
    const files = ['templates/cv-template.variant-a.html', 'templates/cv-template.variant-b.html', 'templates/cover-letter-template.external-cover.html'];
    for (const file of files) writeFileSync(join(systemRoot, file), `selected local ${file}`);
    const dataRoots = configuredTemplateDataRoots({ systemRoot, dataRoot: external, usersDir: users });
    assert.deepEqual(new Set(dataRoots), new Set([external, join(users, 'fictional-a'), join(users, 'fictional-b')]));
    const snapshot = await snapshotConfiguredTemplateVariants({ systemRoot, dataRoots, remoteFiles: files, readRemoteContent: () => 'upstream content' });
    assert.deepEqual(new Set(snapshot.preservedPaths), new Set(files));
    assert.deepEqual(new Set(snapshot.configuredVariants.cv), new Set(['variant-a', 'variant-b']));
    assert.equal(snapshot.configuredVariants.cover, 'external-cover');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
