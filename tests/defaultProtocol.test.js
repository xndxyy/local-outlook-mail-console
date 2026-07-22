import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('IMAP is the default protocol and Graph is opt-in', () => {
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(html, /id="toggleGraph" type="checkbox"/);
  assert.doesNotMatch(html, /id="toggleGraph" type="checkbox" checked/);
  assert.match(html, /id="toggleImap" type="checkbox" checked/);
});
