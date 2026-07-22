import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalAccountStore } from '../src/server/accountStore.js';

const THUNDERBIRD_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';

test('server account store survives restart without exposing credentials', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-outlook-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'accounts.json');
  const imported = {
    id: 'account-1',
    email: 'teacher@outlook.com',
    clientId: 'client-id-123456',
    refreshToken: 'refresh-token-123456',
    password: 'discard-this-password',
  };

  const firstStore = new LocalAccountStore({ filePath });
  await firstStore.importAccounts([imported]);

  const secondStore = new LocalAccountStore({ filePath });
  const accounts = await secondStore.listAccounts();
  const credential = await secondStore.getCredential('account-1', 'imap');
  const raw = await readFile(filePath, 'utf8');

  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0].protocols, ['graph', 'imap']);
  assert.equal(Object.hasOwn(accounts[0], 'refreshToken'), false);
  assert.equal(Object.hasOwn(accounts[0], 'password'), false);
  assert.equal(credential.refreshToken, 'refresh-token-123456');
  assert.equal(raw.includes('discard-this-password'), false);
  assert.equal(raw.includes('refresh-token-123456'), false);
});

test('device authorization can add a protocol grant to an existing account', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-outlook-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalAccountStore({ filePath: join(directory, 'accounts.json') });

  await store.upsertGrant({
    email: 'teacher@outlook.com',
    protocol: 'imap',
    clientId: THUNDERBIRD_CLIENT_ID,
    refreshToken: 'imap-refresh-token',
  });
  await store.upsertGrant({
    email: 'TEACHER@outlook.com',
    protocol: 'graph',
    clientId: THUNDERBIRD_CLIENT_ID,
    refreshToken: 'graph-refresh-token',
  });

  const accounts = await store.listAccounts();
  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0].protocols, ['graph', 'imap']);
  assert.equal((await store.getCredential(accounts[0].id, 'graph')).refreshToken, 'graph-refresh-token');
});

test('Thunderbird imports expose IMAP only and reject a synthetic Graph grant', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-outlook-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalAccountStore({ filePath: join(directory, 'accounts.json') });

  const accounts = await store.importAccounts([{
    id: 'thunderbird-account',
    email: 'teacher@outlook.com',
    clientId: THUNDERBIRD_CLIENT_ID,
    refreshToken: 'thunderbird-refresh-token',
  }]);

  assert.deepEqual(accounts[0].protocols, ['imap']);
  assert.equal(
    (await store.getCredential('thunderbird-account', 'imap')).refreshToken,
    'thunderbird-refresh-token'
  );
  await assert.rejects(
    store.getCredential('thunderbird-account', 'graph'),
    /GRAPH has not been authorized/
  );
});

test('legacy imported Thunderbird Graph grants are hidden without reimporting', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-outlook-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalAccountStore({ filePath: join(directory, 'accounts.json') });
  const now = new Date().toISOString();

  await store.writeData({
    version: 3,
    accounts: [{
      id: 'legacy-account',
      email: 'teacher@outlook.com',
      grants: {
        imap: await store.createGrant(THUNDERBIRD_CLIENT_ID, 'imap-token', 'import'),
        graph: await store.createGrant(THUNDERBIRD_CLIENT_ID, 'graph-token', 'import'),
      },
      addedAt: now,
      updatedAt: now,
    }],
  });

  const accounts = await store.listAccounts();
  assert.deepEqual(accounts[0].protocols, ['imap']);
  await assert.rejects(
    store.getCredential('legacy-account', 'graph'),
    /GRAPH has not been authorized/
  );
});
