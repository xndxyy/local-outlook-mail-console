import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchImapMessages,
  formatImapAttemptErrors,
  getImapHostCandidates,
} from '../src/server/imap.js';

test('fetchImapMessages falls back to Outlook REST after both IMAP hosts disconnect', async () => {
  const attemptedHosts = [];
  let restCalls = 0;

  const result = await fetchImapMessages({
    email: 'teacher@outlook.com',
    clientId: 'client-id',
    refreshToken: 'refresh-token',
    limit: 5,
  }, {
    exchangeToken: async () => ({
      accessToken: 'access-token',
      candidateLabel: 'entra-v2-consumers',
      scope: 'IMAP.AccessAsUser.All Mail.ReadWrite',
    }),
    fetchRaw: async ({ host }) => {
      attemptedHosts.push(host);
      const error = new Error('Command failed');
      error.responseStatus = 'NO';
      error.responseText = 'User is authenticated but not connected.';
      throw error;
    },
    fetchRest: async ({ accessToken, payload, limit }) => {
      restCalls += 1;
      assert.equal(accessToken, 'access-token');
      assert.equal(payload.email, 'teacher@outlook.com');
      assert.equal(limit, 5);
      return {
        emails: [{ id: 'rest-1', protocol: 'imap', folder: 'inbox', date: '2026-07-19T01:00:00Z' }],
      };
    },
  });

  assert.deepEqual(attemptedHosts, ['outlook.office365.com', 'imap-mail.outlook.com']);
  assert.equal(restCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(result.diagnostics.fallback, 'outlook-rest-v2');
  assert.equal(result.diagnostics.host, 'outlook-rest-v2');
});

test('getImapHostCandidates prefers Office365 for modern Entra tokens', () => {
  assert.deepEqual(
    getImapHostCandidates({}, { candidateLabel: 'entra-v2-common' }),
    ['outlook.office365.com', 'imap-mail.outlook.com']
  );
});

test('getImapHostCandidates prefers legacy Outlook host for legacy Live tokens', () => {
  assert.deepEqual(
    getImapHostCandidates({}, { candidateLabel: 'legacy-live' }),
    ['imap-mail.outlook.com', 'outlook.office365.com']
  );
});

test('formatImapAttemptErrors includes host, token source and XOAUTH2 diagnostics', () => {
  const error = new Error('Command failed');
  error.responseStatus = 'NO';
  error.responseText = 'User is authenticated but not connected.';

  const message = formatImapAttemptErrors(
    [{ host: 'outlook.office365.com', error }],
    { candidateLabel: 'entra-v1-common' }
  );

  assert.match(message, /outlook\.office365\.com/);
  assert.match(message, /entra-v1-common/);
  assert.match(message, /XOAUTH2/);
  assert.match(message, /User is authenticated but not connected/);
});
