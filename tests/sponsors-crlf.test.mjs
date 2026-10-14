import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRows, rowsRange, renderRows } from '../.github/scripts/sponsors.mjs';

const rows = renderRows([{ name: 'Fixture', url: 'https://example.org', logo: 'docs/sponsors/fixture.svg', description: 'Fictional sponsor' }]);
test('translated sponsor rows accept CRLF without reporting content drift', () => {
  const text = `## Fixture heading\n\n${rows}\n\n> Fixture note\n`.replace(/\n/g, '\r\n');
  assert.equal(currentRows(text), rows);
});
test('CRLF sponsor ranges retain raw offsets for replacements', () => {
  const prefix = '## Fixture\r\n\r\n', suffix = '\r\n\r\n> Fixture note\r\n';
  const text = prefix + rows.replace(/\n/g, '\r\n') + suffix;
  const range = rowsRange(text);
  assert.equal(text.slice(0, range.from), prefix);
  assert.equal(text.slice(range.to), suffix);
});
