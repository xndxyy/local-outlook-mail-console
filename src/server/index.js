import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchGraphMessages } from './graph.js';
import { fetchImapMessages } from './imap.js';
import { LocalAccountStore } from './accountStore.js';
import { DeviceAuthManager } from './deviceAuth.js';
import { parseImportText } from '../shared/importParser.js';
import {
  getSecurityHeaders,
  isAllowedLocalHost,
  isLoopbackAddress,
  redactSensitive,
} from './security.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = normalize(join(__dirname, '..', '..'));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const SHARED_DIR = join(ROOT_DIR, 'src', 'shared');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const JSON_LIMIT_BYTES = 256 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

export function createLocalServer({
  host = HOST,
  accountStore = new LocalAccountStore(),
  deviceAuthManager = new DeviceAuthManager({ accountStore }),
  fetchGraph = fetchGraphMessages,
  fetchImap = fetchImapMessages,
} = {}) {
  const activeSessions = new Set();

  return createServer(async (req, res) => {
    try {
      if (!isLocalRequest(req)) {
        return sendJson(res, 403, { success: false, error: 'Localhost access required' });
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${PORT}`}`);

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, {
          success: true,
          host,
          mode: 'local-only',
          persistence: 'server-encrypted-file',
          activeSessions: activeSessions.size,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/app-session') {
        return openAppSession(req, res, activeSessions);
      }

      if (req.method === 'GET' && url.pathname === '/api/accounts') {
        return sendJson(res, 200, {
          success: true,
          accounts: await accountStore.listAccounts(),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/accounts/import') {
        const payload = await readJson(req);
        const existing = (await accountStore.listAccounts()).map((account) => account.email);
        const parsed = parseImportText(payload.text, existing);
        const accounts = await accountStore.importAccounts(parsed.accounts);
        return sendJson(res, 200, {
          success: true,
          imported: parsed.accounts.length,
          accounts,
          errors: parsed.errors,
        });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/accounts') {
        await accountStore.clear();
        return sendJson(res, 200, { success: true, accounts: [] });
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
        const accountId = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
        const removed = await accountStore.removeAccount(accountId);
        return sendJson(res, removed ? 200 : 404, {
          success: removed,
          error: removed ? undefined : 'Account not found',
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/device/start') {
        const payload = await readJson(req);
        return sendJson(res, 200, {
          success: true,
          ...await deviceAuthManager.start(payload),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/device/poll') {
        const payload = await readJson(req);
        return sendJson(res, 200, {
          success: true,
          ...await deviceAuthManager.poll(payload.sessionId),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/fetch-graph') {
        const payload = await readJson(req);
        const credential = await accountStore.getCredential(payload.accountId, 'graph');
        const result = await fetchGraph({ ...payload, ...credential });
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/fetch-imap') {
        const payload = await readJson(req);
        const credential = await accountStore.getCredential(payload.accountId, 'imap');
        const result = await fetchImap({ ...payload, ...credential });
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res, url.pathname);
      }

      return sendJson(res, 405, { success: false, error: 'Method not allowed' });
    } catch (error) {
      return sendJson(res, 500, {
        success: false,
        error: 'Request failed',
        detail: redactSensitive(error?.message || String(error)),
      });
    }
  });
}

export function startLocalServer({ host = HOST, port = PORT, ...dependencies } = {}) {
  const server = createLocalServer({ host, ...dependencies });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        host,
        port: resolvedPort,
        url: `http://${host}:${resolvedPort}`,
      });
    });
  });
}

if (isDirectRun()) {
  startLocalServer({ host: HOST, port: PORT })
    .then(({ url }) => {
      console.log(`Local Outlook Mail Console listening at ${url}`);
    })
    .catch((error) => {
      console.error(redactSensitive(error?.message || String(error)));
      process.exit(1);
    });
}

function isLocalRequest(req) {
  return isAllowedLocalHost(req.headers.host || '') && isLoopbackAddress(req.socket.remoteAddress);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, getSecurityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

function openAppSession(req, res, activeSessions) {
  const session = Symbol('desktop-page');
  activeSessions.add(session);
  res.writeHead(200, {
    ...getSecurityHeaders('text/event-stream; charset=utf-8'),
    Connection: 'keep-alive',
  });
  res.write('event: ready\ndata: {}\n\n');

  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);
  const close = () => {
    clearInterval(heartbeat);
    activeSessions.delete(session);
  };
  req.once('close', close);
  res.once('close', close);
}

async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    return sendJson(res, 404, { success: false, error: 'Not found' });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
  } catch {
    return sendJson(res, 404, { success: false, error: 'Not found' });
  }

  const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, getSecurityHeaders(contentType));
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

function resolveStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const cleanPath = decoded === '/' ? '/index.html' : decoded;

  if (cleanPath.startsWith('/shared/')) {
    const sharedPath = normalize(join(SHARED_DIR, cleanPath.replace('/shared/', '')));
    return sharedPath.startsWith(SHARED_DIR) ? sharedPath : null;
  }

  const publicPath = normalize(join(PUBLIC_DIR, cleanPath));
  return publicPath.startsWith(PUBLIC_DIR) ? publicPath : null;
}

function isDirectRun() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}
