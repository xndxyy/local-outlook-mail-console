import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitive, isAllowedLocalHost } from '../src/server/security.js';

test('redactSensitive removes refresh tokens, bearer tokens, and client secrets from messages', () => {
  const message = [
    'refresh_token=0.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'Authorization: Bearer eyJhbGciOiJsecret.payload.signature',
    'client_secret=super-secret-value',
  ].join(' ');

  const redacted = redactSensitive(message);

  assert.doesNotMatch(redacted, /0\.ABC/);
  assert.doesNotMatch(redacted, /eyJhbGci/);
  assert.doesNotMatch(redacted, /super-secret-value/);
  assert.match(redacted, /\[redacted/);
});

test('isAllowedLocalHost accepts only loopback hosts by default', () => {
  assert.equal(isAllowedLocalHost('127.0.0.1:4173'), true);
  assert.equal(isAllowedLocalHost('localhost:4173'), true);
  assert.equal(isAllowedLocalHost('[::1]:4173'), true);
  assert.equal(isAllowedLocalHost('mail.chatai.codes'), false);
  assert.equal(isAllowedLocalHost('192.168.1.10:4173'), false);
});
