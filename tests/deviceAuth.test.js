import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceAuthManager,
  MICROSOFT_THUNDERBIRD_CLIENT_ID,
} from '../src/server/deviceAuth.js';

test('device authorization requests an IMAP grant and persists the completed account', async () => {
  const calls = [];
  const saved = [];
  const manager = new DeviceAuthManager({
    accountStore: {
      upsertGrant: async (grant) => {
        saved.push(grant);
        return { id: 'saved-account', email: grant.email, protocols: [grant.protocol] };
      },
    },
    idFactory: () => 'session-1',
    fetchImpl: async (url, options) => {
      const body = new URLSearchParams(options.body);
      calls.push({ url, body });
      if (url.endsWith('/devicecode')) {
        return jsonResponse(200, {
          device_code: 'private-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://www.microsoft.com/link',
          expires_in: 900,
          interval: 5,
          message: 'Open the link and enter the code.',
        });
      }
      return jsonResponse(200, {
        access_token: 'access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        id_token: fakeIdToken({ preferred_username: 'teacher@outlook.com' }),
      });
    },
  });

  const started = await manager.start({ protocol: 'imap', email: 'teacher@outlook.com' });
  const completed = await manager.poll(started.sessionId);

  assert.equal(started.sessionId, 'session-1');
  assert.equal(started.userCode, 'ABCD-EFGH');
  assert.equal(Object.hasOwn(started, 'deviceCode'), false);
  assert.equal(calls[0].body.get('client_id'), MICROSOFT_THUNDERBIRD_CLIENT_ID);
  assert.match(calls[0].body.get('scope'), /IMAP\.AccessAsUser\.All/);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.account.email, 'teacher@outlook.com');
  assert.equal(Object.hasOwn(completed, 'refreshToken'), false);
  assert.equal(saved[0].refreshToken, 'new-refresh-token');
  assert.equal(saved[0].protocol, 'imap');
});

test('device authorization reports pending without losing its session', async () => {
  let tokenCalls = 0;
  const manager = new DeviceAuthManager({
    accountStore: { upsertGrant: async () => assert.fail('must not persist pending authorization') },
    idFactory: () => 'session-pending',
    fetchImpl: async (url) => {
      if (url.endsWith('/devicecode')) {
        return jsonResponse(200, {
          device_code: 'private-device-code',
          user_code: 'WAIT-CODE',
          verification_uri: 'https://www.microsoft.com/link',
          expires_in: 900,
          interval: 5,
        });
      }
      tokenCalls += 1;
      return jsonResponse(400, { error: 'authorization_pending' });
    },
  });

  await manager.start({ protocol: 'graph', email: 'teacher@outlook.com' });
  assert.deepEqual(await manager.poll('session-pending'), { status: 'pending', interval: 5 });
  assert.deepEqual(await manager.poll('session-pending'), { status: 'pending', interval: 5 });
  assert.equal(tokenCalls, 2);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function fakeIdToken(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}
