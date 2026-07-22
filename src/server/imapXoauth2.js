import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

const DEFAULT_PORT = 993;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function fetchImapRawMessages({
  email,
  accessToken,
  host,
  port = DEFAULT_PORT,
  limit = 10,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  socketFactory = createTlsSocket,
}) {
  const client = new Xoauth2ImapClient({
    email,
    accessToken,
    host,
    port,
    timeoutMs,
    socketFactory,
  });

  try {
    await client.connect();
    const capabilities = await client.capability();
    await client.authenticate();
    const exists = await client.examineInbox();

    if (exists === 0) {
      return {
        records: [],
        diagnostics: {
          host,
          authMechanism: 'XOAUTH2',
          connectionAddress: client.connectionAddress,
          connectionFamily: client.connectionFamily,
          capabilities: [...capabilities],
          exists,
        },
      };
    }

    const windowSize = Math.min(exists, Math.max(limit * 5, 10));
    const start = Math.max(1, exists - windowSize + 1);
    const records = await client.fetchBodyPeekRange(`${start}:*`);

    return {
      records,
      diagnostics: {
        host,
        authMechanism: 'XOAUTH2',
        connectionAddress: client.connectionAddress,
        connectionFamily: client.connectionFamily,
        capabilities: [...capabilities],
        exists,
        fetchedWindow: `${start}:*`,
      },
    };
  } finally {
    await client.close();
  }
}

export function buildXoauth2Sasl(email, accessToken) {
  return [`user=${email}`, `auth=Bearer ${accessToken}`, '', ''].join('\x01');
}

export function buildXoauth2InitialResponse(email, accessToken) {
  return Buffer.from(buildXoauth2Sasl(email, accessToken), 'utf8').toString('base64');
}

export function parseFetchRecords(frames) {
  const records = [];
  let current = null;

  for (const frame of frames || []) {
    if (frame.type === 'line') {
      const text = frame.text || '';
      if (/^\* \d+ FETCH\b/i.test(text)) {
        if (current?.source) records.push(toFetchRecord(current));
        current = { meta: [text], source: null };
      } else if (current) {
        current.meta.push(text);
        if (text.trim().endsWith(')') && current.source) {
          records.push(toFetchRecord(current));
          current = null;
        }
      }
      continue;
    }

    if (frame.type === 'literal' && current) {
      current.source = frame.data;
    }
  }

  if (current?.source) records.push(toFetchRecord(current));
  return records;
}

function toFetchRecord(item) {
  const meta = item.meta.join(' ');
  return {
    uid: extractNumber(meta, /\bUID\s+(\d+)/i),
    internalDate: extractInternalDate(meta),
    source: item.source,
  };
}

function extractNumber(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractInternalDate(value) {
  const match = String(value || '').match(/\bINTERNALDATE\s+"([^"]+)"/i);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date;
}

class Xoauth2ImapClient {
  constructor({ email, accessToken, host, port, timeoutMs, socketFactory }) {
    this.email = email;
    this.accessToken = accessToken;
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.socketFactory = socketFactory;
    this.buffer = Buffer.alloc(0);
    this.tagCounter = 0;
    this.waiters = [];
    this.closedError = null;
    this.socket = null;
    this.connectionAddress = '';
    this.connectionFamily = '';
  }

  async connect() {
    this.socket = await this.socketFactory({
      host: this.host,
      port: this.port,
      timeoutMs: this.timeoutMs,
    });
    this.connectionAddress = this.socket.connectionAddress || this.socket.remoteAddress || '';
    this.connectionFamily = this.socket.connectionFamily || this.socket.remoteFamily || '';
    this.bindSocket();
    const greeting = await this.readLine();
    if (!/^\* OK\b/i.test(greeting)) {
      throw createImapError('IMAP greeting failed', {
        host: this.host,
        connectionAddress: this.connectionAddress,
        connectionFamily: this.connectionFamily,
        responseText: greeting,
      });
    }
  }

  async capability() {
    const response = await this.sendCommand('CAPABILITY');
    expectOk(response, 'CAPABILITY', this.host, {
      connectionAddress: this.connectionAddress,
      connectionFamily: this.connectionFamily,
    });

    const capabilities = new Set();
    for (const frame of response.frames) {
      if (frame.type !== 'line' || !/^\* CAPABILITY\b/i.test(frame.text)) continue;
      frame.text
        .replace(/^\* CAPABILITY\s+/i, '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((capability) => capabilities.add(capability.toUpperCase()));
    }
    return capabilities;
  }

  async authenticate() {
    let oauthError = null;
    const initialResponse = buildXoauth2InitialResponse(this.email, this.accessToken);
    const response = await this.sendCommand(`AUTHENTICATE XOAUTH2 ${initialResponse}`, {
      onContinuation: async (line) => {
        oauthError = parseOauthContinuation(line);
        this.socket.write('\r\n');
      },
    });

    if (response.status !== 'OK') {
      throw createImapError('AUTHENTICATE XOAUTH2 failed', {
        host: this.host,
        connectionAddress: this.connectionAddress,
        connectionFamily: this.connectionFamily,
        authenticationFailed: true,
        responseStatus: response.status,
        responseText: response.text,
        oauthError,
      });
    }
  }

  async examineInbox() {
    const response = await this.sendCommand('EXAMINE INBOX');
    expectOk(response, 'EXAMINE INBOX', this.host, {
      connectionAddress: this.connectionAddress,
      connectionFamily: this.connectionFamily,
    });

    for (const frame of response.frames) {
      if (frame.type !== 'line') continue;
      const match = frame.text.match(/^\* (\d+) EXISTS\b/i);
      if (match) return Number.parseInt(match[1], 10);
    }
    return 0;
  }

  async fetchBodyPeekRange(range) {
    const response = await this.sendCommand(`FETCH ${range} (UID INTERNALDATE BODY.PEEK[])`);
    expectOk(response, 'FETCH', this.host, {
      connectionAddress: this.connectionAddress,
      connectionFamily: this.connectionFamily,
    });
    return parseFetchRecords(response.frames);
  }

  async close() {
    if (!this.socket) return;
    if (!this.socket.destroyed && !this.closedError) {
      try {
        await this.sendCommand('LOGOUT');
      } catch {
        // Logout is best-effort; the socket may already be closed by the server.
      }
    }
    this.socket.destroy();
    this.socket = null;
  }

  bindSocket() {
    this.socket.setTimeout(this.timeoutMs, () => {
      this.fail(new Error(`IMAP socket timed out for ${this.host}`));
      this.socket.destroy();
    });

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.resolveWaiters();
    });
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('close', () => this.fail(new Error(`IMAP socket closed for ${this.host}`)));
  }

  async sendCommand(command, options = {}) {
    const tag = this.nextTag();
    this.socket.write(`${tag} ${command}\r\n`);
    return this.readTaggedResponse(tag, options);
  }

  async readTaggedResponse(tag, { onContinuation } = {}) {
    const frames = [];

    while (true) {
      const text = await this.readLine();
      frames.push({ type: 'line', text });

      if (text.startsWith('+') && onContinuation) {
        await onContinuation(text);
      }

      const literalLength = getLiteralLength(text);
      if (literalLength !== null) {
        frames.push({ type: 'literal', data: await this.readBytes(literalLength) });
      }

      if (isTaggedLine(text, tag)) {
        const status = parseTaggedStatus(text, tag);
        return { status, text, frames };
      }
    }
  }

  async readLine() {
    while (true) {
      const index = this.buffer.indexOf('\r\n');
      if (index >= 0) {
        const line = this.buffer.subarray(0, index).toString('utf8');
        this.buffer = this.buffer.subarray(index + 2);
        return line;
      }
      await this.waitForData();
    }
  }

  async readBytes(length) {
    while (this.buffer.length < length) {
      await this.waitForData();
    }
    const literal = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return literal;
  }

  waitForData() {
    if (this.closedError) throw this.closedError;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  resolveWaiters() {
    const waiters = this.waiters.splice(0);
    waiters.forEach(({ resolve }) => resolve());
  }

  fail(error) {
    if (!this.closedError) this.closedError = error;
    const waiters = this.waiters.splice(0);
    waiters.forEach(({ reject }) => reject(this.closedError));
  }

  nextTag() {
    this.tagCounter += 1;
    return `A${String(this.tagCounter).padStart(4, '0')}`;
  }
}

async function createTlsSocket({ host, port, timeoutMs }) {
  return connectToBestAddress(host, port, timeoutMs, true);
}

function expectOk(response, command, host, details = {}) {
  if (response.status === 'OK') return;
  throw createImapError(`${command} failed`, {
    host,
    ...details,
    responseStatus: response.status,
    responseText: response.text,
  });
}

function createImapError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function getLiteralLength(line) {
  const match = String(line || '').match(/\{(\d+)\+?\}$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isTaggedLine(line, tag) {
  return String(line || '').toUpperCase().startsWith(`${tag.toUpperCase()} `);
}

function parseTaggedStatus(line, tag) {
  return String(line || '')
    .slice(tag.length)
    .trim()
    .split(/\s+/, 1)[0]
    ?.toUpperCase() || '';
}

function parseOauthContinuation(line) {
  const encoded = String(line || '').replace(/^\+\s*/, '').trim();
  if (!encoded) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
}

async function connectToBestAddress(host, port, timeoutMs, preferIPv4 = true) {
  const targets = await resolveConnectionTargets(host, preferIPv4);
  const failures = [];

  for (const target of targets) {
    try {
      return await connectToTarget(target, port, timeoutMs, host);
    } catch (error) {
      failures.push({
        address: target.address,
        family: target.family,
        error,
      });
    }
  }

  const error = createImapError(`IMAP connection failed for ${host}`);
  error.attempts = failures;
  throw error;
}

async function resolveConnectionTargets(host, preferIPv4) {
  if (net.isIP(host)) {
    return [{ address: host, family: net.isIP(host) }];
  }

  try {
    const records = await dns.lookup(host, { all: true });
    return prioritizeAddressRecords(records, preferIPv4);
  } catch {
    return [{ address: host, family: 0 }];
  }
}

export function prioritizeAddressRecords(records, preferIPv4) {
  return [...records]
    .filter((record) => record?.address)
    .map((record) => ({
      address: record.address,
      family: record.family || net.isIP(record.address) || 0,
    }))
    .sort((left, right) => {
      if (left.family === right.family) return left.address.localeCompare(right.address);
      if (preferIPv4) return left.family === 4 ? -1 : 1;
      return left.family === 6 ? -1 : 1;
    });
}

async function connectToTarget(target, port, timeoutMs, servername) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: target.address,
      port,
      servername: net.isIP(servername) ? false : servername,
      family: target.family || undefined,
      minVersion: 'TLSv1.2',
    });

    socket.connectionAddress = target.address;
    socket.connectionFamily = target.family === 6 ? 'IPv6' : target.family === 4 ? 'IPv4' : '';

    const timer = setTimeout(() => {
      socket.destroy();
      reject(createImapError(`IMAP connection timed out for ${servername}`, {
        connectionAddress: target.address,
        connectionFamily: socket.connectionFamily,
      }));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('secureConnect', onConnect);
    };
    const onError = (error) => {
      cleanup();
      reject(createImapError(error.message || `IMAP connection failed for ${servername}`, {
        connectionAddress: target.address,
        connectionFamily: socket.connectionFamily,
        cause: error,
      }));
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    socket.once('error', onError);
    socket.once('secureConnect', onConnect);
  });
}
