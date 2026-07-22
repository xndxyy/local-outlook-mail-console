import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('approved local mail icon assets exist and are referenced by the app', () => {
  const svg = readFileSync('desktop/local-outlook-mail-icon.svg', 'utf8');
  const ico = readFileSync('desktop/local-outlook-mail.ico');
  const png = readFileSync('public/local-outlook-mail-icon.png');
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(svg, /#202A32/i);
  assert.match(svg, /#21B8A6/i);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4) >= 6, true);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.match(html, /local-outlook-mail-icon\.png/);
  assert.match(html, /favicon\.ico/);
});
