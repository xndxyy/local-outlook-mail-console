import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('desktop EXE launcher starts the D drive portable app without a console', () => {
  const source = readFileSync('desktop/LocalOutlookLauncher.cs', 'utf8');
  const buildScript = readFileSync('desktop/build-launcher-exe.ps1', 'utf8');

  assert.match(source, /D:\\LocalOutlookMailConsole/);
  assert.match(source, /runtime/);
  assert.match(source, /node\.exe/);
  assert.match(source, /launch-app\.mjs/);
  assert.match(source, /LOCAL_OUTLOOK_DATA_DIR/);
  assert.match(source, /CreateNoWindow = true/);
  assert.match(source, /UseShellExecute = false/);
  assert.match(buildScript, /local-outlook-mail\.ico/);
  assert.match(buildScript, /win32icon/);
  assert.match(buildScript, /LocalOutlookLauncher\.cs/);
  assert.equal(/^[\x00-\x7F]*$/.test(buildScript), true);
  assert.match(buildScript, /0x672C/);
});
