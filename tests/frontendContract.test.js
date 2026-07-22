import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('frontend uses server-side accounts and never sends stored refresh tokens', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const script = readFileSync('public/app.js', 'utf8');

  assert.match(html, /id="btnMicrosoftLogin"/);
  assert.match(html, /id="deviceAuthModal"/);
  assert.match(script, /apiRequest\('\/api\/accounts'/);
  assert.match(script, /new EventSource\('\/api\/app-session'\)/);
  assert.match(script, /accountId:\s*account\.id/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(script, /refreshToken:\s*account\.refreshToken/);
});
