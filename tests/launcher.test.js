import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Windows desktop launcher opens a loopback Edge app window', () => {
  const script = readFileSync('desktop/launch-app.mjs', 'utf8');
  const cmd = readFileSync('desktop/本地Outlook取件台.cmd', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.match(script, /msedge\.exe/);
  assert.match(script, /--app=/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /4173/);
  assert.match(script, /src\/server\/index\.js/);
  assert.match(script, /LocalOutlookMailConsole/);
  assert.match(script, /process\.env\.LOCAL_OUTLOOK_DATA_DIR/);
  assert.match(script, /stdio:\s*\['ignore', 'pipe', 'pipe'\]/);
  assert.match(script, /serverProcess\.stdout\.pipe\(serverOut\)/);
  assert.match(script, /serverProcess\.stderr\.pipe\(serverErr\)/);
  assert.match(script, /waitForAppSession\(port\)/);
  assert.match(script, /waitForAppSessionEnd\(port\)/);
  assert.match(cmd, /runtime\\node\.exe/);
  assert.match(cmd, /launch-app\.mjs/);
  assert.equal(packageJson.scripts.desktop, 'node desktop/launch-app.mjs');
  assert.doesNotMatch(script, /mail\.chatai\.codes/);
});
