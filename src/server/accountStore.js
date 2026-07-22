import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const STORE_VERSION = 3;
const PROTOCOLS = new Set(['graph', 'imap']);
const THUNDERBIRD_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';

export class LocalAccountStore {
  constructor({ filePath = getDefaultAccountStorePath(), keyPath = `${filePath}.key` } = {}) {
    this.filePath = filePath;
    this.keyPath = keyPath;
    this.keyPromise = null;
  }

  async listAccounts() {
    const data = await this.readData();
    return data.accounts.map(toPublicAccount);
  }

  async importAccounts(accounts) {
    const data = await this.readData();

    for (const account of accounts || []) {
      if (!account?.email || !account?.clientId || !account?.refreshToken) continue;
      const stored = findOrCreateAccount(data.accounts, account.email, account.id);
      stored.grants.imap = await this.createGrant(account.clientId, account.refreshToken, 'import');
      if (isThunderbirdClientId(account.clientId)) {
        if (isUnsupportedImportedGraphGrant(stored.grants.graph)) delete stored.grants.graph;
      } else {
        stored.grants.graph = await this.createGrant(account.clientId, account.refreshToken, 'import');
      }
      stored.updatedAt = new Date().toISOString();
    }

    await this.writeData(data);
    return data.accounts.map(toPublicAccount);
  }

  async upsertGrant({ email, protocol, clientId, refreshToken }) {
    const normalizedProtocol = normalizeProtocol(protocol);
    if (!email || !String(email).includes('@')) throw new Error('Microsoft did not return a valid email address');
    if (!clientId || !refreshToken) throw new Error('Microsoft authorization did not return reusable credentials');

    const data = await this.readData();
    const stored = findOrCreateAccount(data.accounts, email);
    stored.grants[normalizedProtocol] = await this.createGrant(clientId, refreshToken, 'microsoft-device-code');
    stored.updatedAt = new Date().toISOString();
    await this.writeData(data);
    return toPublicAccount(stored);
  }

  async getCredential(accountId, protocol) {
    const normalizedProtocol = normalizeProtocol(protocol);
    const data = await this.readData();
    const account = data.accounts.find((item) => item.id === String(accountId || ''));
    if (!account) throw new Error('Account not found');
    const grant = account.grants?.[normalizedProtocol];
    if (!grant || (normalizedProtocol === 'graph' && isUnsupportedImportedGraphGrant(grant))) {
      throw new Error(`${normalizedProtocol.toUpperCase()} has not been authorized for this account`);
    }

    return {
      email: account.email,
      clientId: grant.clientId,
      refreshToken: await this.decrypt(grant.refreshToken),
    };
  }

  async removeAccount(accountId) {
    const data = await this.readData();
    const nextAccounts = data.accounts.filter((account) => account.id !== String(accountId || ''));
    if (nextAccounts.length === data.accounts.length) return false;
    data.accounts = nextAccounts;
    await this.writeData(data);
    return true;
  }

  async clear() {
    await this.writeData(createEmptyStore());
  }

  async createGrant(clientId, refreshToken, source) {
    return {
      clientId: String(clientId),
      refreshToken: await this.encrypt(String(refreshToken)),
      source,
      updatedAt: new Date().toISOString(),
    };
  }

  async readData() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.accounts)) return createEmptyStore();
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyStore();
      throw new Error(`Unable to read local account store: ${error.message}`);
    }
  }

  async writeData(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify({ ...data, version: STORE_VERSION }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(tempPath, this.filePath);
  }

  async encrypt(value) {
    const key = await this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  async decrypt(value) {
    const [version, ivText, tagText, ciphertextText] = String(value || '').split('.');
    if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new Error('Local credential is invalid');
    const decipher = createDecipheriv('aes-256-gcm', await this.getKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  async getKey() {
    if (!this.keyPromise) this.keyPromise = loadOrCreateKey(this.keyPath);
    return this.keyPromise;
  }
}

export function getDefaultAccountStorePath(env = process.env) {
  const base = env.LOCAL_OUTLOOK_DATA_DIR
    || join(env.LOCALAPPDATA || env.APPDATA || process.cwd(), 'LocalOutlookMailConsole');
  return join(base, 'data', 'accounts.json');
}

async function loadOrCreateKey(keyPath) {
  try {
    const key = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64url');
    if (key.length !== 32) throw new Error('Invalid key length');
    return key;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Unable to read local credential key: ${error.message}`);
  }

  await mkdir(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  try {
    const handle = await open(keyPath, 'wx', 0o600);
    await handle.writeFile(key.toString('base64url'), 'utf8');
    await handle.close();
    return key;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return loadOrCreateKey(keyPath);
  }
}

function createEmptyStore() {
  return { version: STORE_VERSION, accounts: [] };
}

function findOrCreateAccount(accounts, email, preferredId) {
  const normalizedEmail = normalizeEmail(email);
  let account = accounts.find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (account) return account;

  const now = new Date().toISOString();
  account = {
    id: String(preferredId || randomUUID()),
    email: String(email).trim(),
    grants: {},
    addedAt: now,
    updatedAt: now,
  };
  accounts.push(account);
  return account;
}

function toPublicAccount(account) {
  return {
    id: account.id,
    email: account.email,
    protocols: Object.entries(account.grants || {})
      .filter(([protocol, grant]) => {
        return PROTOCOLS.has(protocol)
          && !(protocol === 'graph' && isUnsupportedImportedGraphGrant(grant));
      })
      .map(([protocol]) => protocol)
      .sort(),
    addedAt: account.addedAt,
    updatedAt: account.updatedAt,
  };
}

function normalizeProtocol(protocol) {
  const value = String(protocol || '').toLowerCase();
  if (!PROTOCOLS.has(value)) throw new Error('Unsupported mail protocol');
  return value;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isUnsupportedImportedGraphGrant(grant) {
  return grant?.source === 'import' && isThunderbirdClientId(grant.clientId);
}

function isThunderbirdClientId(clientId) {
  return String(clientId || '').trim().toLowerCase() === THUNDERBIRD_CLIENT_ID;
}
