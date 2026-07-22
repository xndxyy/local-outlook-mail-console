import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportText, formatImportErrors } from '../src/shared/importParser.js';

test('parses four-field Outlook import lines and discards password values', () => {
  const result = parseImportText([
    'teacher@outlook.com----p@ss-word----11111111-2222-3333-4444-555555555555----0.AAA-token-part',
    'student@hotmail.com--ignored-password--client-id--refresh-token',
  ].join('\n'));

  assert.equal(result.accounts.length, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(result.accounts[0].email, 'teacher@outlook.com');
  assert.equal(result.accounts[0].clientId, '11111111-2222-3333-4444-555555555555');
  assert.equal(result.accounts[0].refreshToken, '0.AAA-token-part');
  assert.equal(Object.hasOwn(result.accounts[0], 'password'), false);
  assert.equal(result.accounts[0].passwordDiscarded, true);
});

test('rejects ambiguous single-dash lines instead of corrupting dashed tokens', () => {
  const result = parseImportText('user@example.com-password-client-id-with-dash-refresh-token-with-dash');

  assert.equal(result.accounts.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(formatImportErrors(result.errors), /use --, ---, or ----/i);
});

test('deduplicates imports by normalized email address', () => {
  const result = parseImportText([
    'USER@example.com----x----client-a-123456----refresh-token-a-123456',
    'user@example.com----x----client-b-123456----refresh-token-b-123456',
  ].join('\n'));

  assert.equal(result.accounts.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /duplicate/i);
});
