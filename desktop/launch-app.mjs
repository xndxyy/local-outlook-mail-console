import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const edgePath = findEdge();

if (!edgePath) {
  throw new Error('Microsoft Edge was not found. Install Edge or WebView2 Runtime first.');
}

const port = await getPreferredPort(4173);
const appDataDir = path.resolve(
  process.env.LOCAL_OUTLOOK_DATA_DIR
    || path.join(process.env.LOCALAPPDATA || projectRoot, 'LocalOutlookMailConsole')
);
const profileDir = path.join(appDataDir, 'edge-profile');
const logsDir = path.join(appDataDir, 'logs');
await mkdir(profileDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const serverOut = createWriteStream(path.join(logsDir, 'desktop-server.out.log'), { flags: 'a' });
const serverErr = createWriteStream(path.join(logsDir, 'desktop-server.err.log'), { flags: 'a' });

const serverProcess = spawn(process.execPath, ['src/server/index.js'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    LOCAL_OUTLOOK_DATA_DIR: appDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
serverProcess.stdout.pipe(serverOut);
serverProcess.stderr.pipe(serverErr);

try {
  await waitForHealth(port);

  const appUrl = `http://127.0.0.1:${port}/`;
  const edgeProcess = spawn(edgePath, [
    `--app=${appUrl}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--disable-sync',
    '--disable-features=Translate',
  ], {
    stdio: 'ignore',
    windowsHide: false,
  });

  edgeProcess.once('error', (error) => serverErr.write(`${error.message}\n`));
  await waitForAppSession(port);
  await waitForAppSessionEnd(port);
} finally {
  if (!serverProcess.killed) {
    serverProcess.kill();
  }
}

function findEdge() {
  const candidates = [
    `${process.env['ProgramFiles(x86)'] || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.LOCALAPPDATA || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return candidates.find((candidate) => candidate && candidate.length && existsSync(candidate));
}

async function waitForHealth(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await getHealth(port);
      if (health.success) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error('Local service failed to start.');
}

async function waitForAppSession(port) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const health = await getHealth(port);
      if (health.activeSessions > 0) return;
    } catch {
      // retry while Edge is starting
    }
    await delay(250);
  }
  throw new Error('Desktop window did not connect to the local service.');
}

async function waitForAppSessionEnd(port) {
  let emptySince = null;

  while (true) {
    try {
      const health = await getHealth(port);
      if (health.activeSessions > 0) {
        emptySince = null;
      } else {
        emptySince ??= Date.now();
        if (Date.now() - emptySince >= 3_000) return;
      }
    } catch {
      return;
    }
    await delay(500);
  }
}

async function getHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
  return await response.json();
}

async function getPreferredPort(preferredPort) {
  if (await canListen(preferredPort)) return preferredPort;
  return await getFreePort();
}

async function canListen(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
