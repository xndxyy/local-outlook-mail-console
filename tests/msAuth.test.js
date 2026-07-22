import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRefreshTokenCandidates,
  exchangeRefreshToken,
} from '../src/server/msAuth.js';

test('buildRefreshTokenCandidates includes valid consumer-compatible authorities', () => {
  const candidates = buildRefreshTokenCandidates({
    clientId: 'client-id',
    refreshToken: 'refresh-token',
    scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
    resource: 'https://outlook.office.com/',
    legacyLiveScopes: 'wl.imap wl.offline_access',
  });

  assert.equal(candidates[0].url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
  assert.equal(candidates[1].url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.equal(candidates[2].url, 'https://login.microsoftonline.com/common/oauth2/token');
  assert.equal(candidates.at(-1).url, 'https://login.live.com/oauth20_token.srf');
  assert.equal(candidates.at(-1).body.get('scope'), 'wl.imap wl.offline_access');
  assert.equal(candidates.some((candidate) => candidate.url.includes('/consumers/oauth2/token')), false);
});

test('exchangeRefreshToken falls back to legacy Live scopes for Outlook.com IMAP tokens', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: new URLSearchParams(options.body) });
    if (url.includes('login.live.com')) {
      return jsonResponse(200, { access_token: 'legacy-access-token' });
    }
    return jsonResponse(400, {
      error_description: 'AADSTS70000: requested scopes are unauthorized or expired',
    });
  };

  const token = await exchangeRefreshToken({
    clientId: 'client-id',
    refreshToken: 'M.fake-sensitive-refresh-token',
    scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
    legacyLiveScopes: 'wl.imap wl.offline_access',
    fetchImpl,
  });

  assert.equal(token, 'legacy-access-token');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://login.live.com/oauth20_token.srf');
});

test('exchangeRefreshToken can return the successful token source for diagnostics', async () => {
  const token = await exchangeRefreshToken({
    clientId: 'client-id',
    refreshToken: 'refresh-token',
    scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
    includeDetails: true,
    fetchImpl: async () => jsonResponse(200, {
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
    }),
  });

  assert.equal(token.accessToken, 'access-token');
  assert.equal(token.candidateLabel, 'entra-v2-consumers');
  assert.equal(token.expiresIn, 3600);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
