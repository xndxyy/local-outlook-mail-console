import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from '../src/server/index.js';

test('app session endpoint tracks an open desktop page until it disconnects', async (context) => {
  const app = await startLocalServer({ host: '127.0.0.1', port: 0 });
  context.after(() => new Promise((resolve) => app.server.close(resolve)));

  const sessionResponse = await fetch(`${app.url}/api/app-session`);
  assert.match(sessionResponse.headers.get('content-type') || '', /text\/event-stream/);
  assert.equal((await readHealth(app.url)).activeSessions, 1);

  await sessionResponse.body.cancel();
  await waitFor(async () => (await readHealth(app.url)).activeSessions === 0);
  assert.equal((await readHealth(app.url)).activeSessions, 0);
});

async function readHealth(baseUrl) {
  return await (await fetch(`${baseUrl}/api/health`)).json();
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('condition was not met before timeout');
}
