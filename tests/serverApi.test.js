import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalAccountStore } from '../src/server/accountStore.js';
import { startLocalServer } from '../src/server/index.js';

test('local API persists imports and resolves credentials by account id', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-outlook-api-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const accountStore = new LocalAccountStore({ filePath: join(directory, 'accounts.json') });
  const fetchedPayloads = [];
  const deviceAuthManager = {
    start: async (payload) => ({ sessionId: 'auth-1', status: 'pending', protocol: payload.protocol }),
    poll: async () => ({ status: 'pending', interval: 5 }),
  };
  const app = await startLocalServer({
    host: '127.0.0.1',
    port: 0,
    accountStore,
    deviceAuthManager,
    fetchImap: async (payload) => {
      fetchedPayloads.push(payload);
      return { success: true, protocol: 'imap', count: 0, emails: [] };
    },
  });
  context.after(() => new Promise((resolve) => app.server.close(resolve)));

  const importResult = await request(app.url, '/api/accounts/import', {
    method: 'POST',
    body: {
      text: 'teacher@outlook.com----discarded-password----client-id-123456----refresh-token-123456',
    },
  });
  assert.equal(importResult.accounts.length, 1);
  assert.equal(JSON.stringify(importResult).includes('refresh-token-123456'), false);

  const listed = await request(app.url, '/api/accounts');
  assert.equal(listed.accounts[0].email, 'teacher@outlook.com');
  assert.equal(Object.hasOwn(listed.accounts[0], 'refreshToken'), false);

  const fetched = await request(app.url, '/api/fetch-imap', {
    method: 'POST',
    body: { accountId: listed.accounts[0].id, keyword: 'invoice', limit: 5 },
  });
  assert.equal(fetched.success, true);
  assert.equal(fetchedPayloads[0].email, 'teacher@outlook.com');
  assert.equal(fetchedPayloads[0].refreshToken, 'refresh-token-123456');
  assert.equal(fetchedPayloads[0].keyword, 'invoice');

  const started = await request(app.url, '/api/auth/device/start', {
    method: 'POST',
    body: { protocol: 'imap' },
  });
  assert.equal(started.sessionId, 'auth-1');

  const removed = await request(app.url, `/api/accounts/${listed.accounts[0].id}`, { method: 'DELETE' });
  assert.equal(removed.success, true);
  assert.deepEqual((await request(app.url, '/api/accounts')).accounts, []);
});

test('local server serves icon assets with browser-compatible MIME types', async (context) => {
  const app = await startLocalServer({ host: '127.0.0.1', port: 0 });
  context.after(() => new Promise((resolve) => app.server.close(resolve)));

  const png = await fetch(`${app.url}/local-outlook-mail-icon.png`);
  const ico = await fetch(`${app.url}/favicon.ico`);
  await png.arrayBuffer();
  await ico.arrayBuffer();

  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
});

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return data;
}
