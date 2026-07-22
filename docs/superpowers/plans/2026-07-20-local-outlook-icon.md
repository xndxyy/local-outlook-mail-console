# Local Outlook Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the approved lock-clasp envelope icon, embed it in the desktop WinExe, and use it as the local app favicon without changing the D-drive runtime or account-data layout.

**Architecture:** A deterministic Pillow generator owns the icon geometry and writes the editable SVG, transparent PNG, and multi-resolution ICO. A focused PowerShell build script compiles the existing C# launcher with the ICO resource. The HTTP server explicitly serves PNG/ICO MIME types and the HTML references the generated assets.

**Tech Stack:** Python 3 with Pillow 12.1.1, SVG, Windows ICO, C# WinExe, PowerShell, Node.js test runner.

**Repository note:** This workspace does not expose a valid Git work tree, so commit steps are replaced by test checkpoints and artifact hashes.

---

### Task 1: Lock The Asset Contract With Failing Tests

**Files:**
- Modify: `tests/exeLauncher.test.js`
- Create: `tests/iconAssets.test.js`
- Modify: `tests/serverApi.test.js`

- [ ] **Step 1: Add launcher integration assertions**

Extend `tests/exeLauncher.test.js` to read `desktop/build-launcher-exe.ps1` and assert that it references `desktop/local-outlook-mail.ico`, `/win32icon:`, and the existing `LocalOutlookLauncher.cs` source.

```js
const buildScript = readFileSync('desktop/build-launcher-exe.ps1', 'utf8');
assert.match(buildScript, /local-outlook-mail\.ico/);
assert.match(buildScript, /win32icon/);
assert.match(buildScript, /LocalOutlookLauncher\.cs/);
```

- [ ] **Step 2: Add asset structure assertions**

Create `tests/iconAssets.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('approved local mail icon assets exist and are referenced by the app', () => {
  const svg = readFileSync('desktop/local-outlook-mail-icon.svg', 'utf8');
  const ico = readFileSync('desktop/local-outlook-mail.ico');
  const png = readFileSync('public/local-outlook-mail-icon.png');
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(svg, /#202A32/i);
  assert.match(svg, /#21B8A6/i);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4) >= 6, true);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.match(html, /local-outlook-mail-icon\.png/);
  assert.match(html, /favicon\.ico/);
});
```

- [ ] **Step 3: Add static MIME assertions**

Add a server test that starts `startLocalServer`, fetches `/local-outlook-mail-icon.png` and `/favicon.ico`, and asserts `image/png` and `image/x-icon` content types.

```js
test('local server serves icon assets with browser-compatible MIME types', async (context) => {
  const app = await startLocalServer({ host: '127.0.0.1', port: 0 });
  context.after(() => new Promise((resolve) => app.server.close(resolve)));

  const png = await fetch(`${app.url}/local-outlook-mail-icon.png`);
  const ico = await fetch(`${app.url}/favicon.ico`);

  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
});
```

- [ ] **Step 4: Run the tests and verify red state**

Run:

```powershell
node --test tests/exeLauncher.test.js tests/iconAssets.test.js tests/serverApi.test.js
```

Expected: FAIL because the generated assets, build script, HTML references, and MIME mappings do not exist yet.

### Task 2: Generate The Approved Vector And Bitmap Assets

**Files:**
- Create: `desktop/build-icon.py`
- Create: `desktop/local-outlook-mail-icon.svg`
- Create: `desktop/local-outlook-mail.ico`
- Create: `public/local-outlook-mail-icon.png`
- Create: `public/favicon.ico`

- [ ] **Step 1: Implement one geometry source**

Create `desktop/build-icon.py` with constants for charcoal `#202A32`, white `#F7FAFC`, teal `#21B8A6`, and the approved rounded tile, envelope, centered lock shackle/body, and keyhole. Draw at 1024 px, downsample with `Image.Resampling.LANCZOS`, and save ICO frames at `16, 24, 32, 48, 64, 128, 256`.

The script must also write a matching SVG using the same coordinates and copy the ICO bytes to `public/favicon.ico`.

```python
from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / 'desktop'
PUBLIC = ROOT / 'public'
SCALE = 4
CHARCOAL = '#202A32'
WHITE = '#F7FAFC'
TEAL = '#21B8A6'
SEAM = '#BAC6CD'
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def scaled_box(values):
    return tuple(int(value * SCALE) for value in values)


def build_master():
    image = Image.new('RGBA', (256 * SCALE, 256 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(scaled_box((12, 12, 244, 244)), radius=52 * SCALE, fill=CHARCOAL)
    draw.rounded_rectangle(scaled_box((40, 68, 216, 182)), radius=18 * SCALE, fill=WHITE)
    draw.line(
        [scaled_box((48, 82))[0:2], scaled_box((128, 137))[0:2], scaled_box((208, 82))[0:2]],
        fill=SEAM,
        width=8 * SCALE,
        joint='curve',
    )
    draw.arc(scaled_box((102, 104, 154, 164)), 180, 360, fill=TEAL, width=16 * SCALE)
    draw.line([scaled_box((102, 134))[0:2], scaled_box((102, 153))[0:2]], fill=TEAL, width=16 * SCALE)
    draw.line([scaled_box((154, 134))[0:2], scaled_box((154, 153))[0:2]], fill=TEAL, width=16 * SCALE)
    draw.rounded_rectangle(scaled_box((90, 139, 166, 210)), radius=14 * SCALE, fill=TEAL)
    draw.ellipse(scaled_box((119, 160, 137, 178)), fill=CHARCOAL)
    draw.rounded_rectangle(scaled_box((124, 173, 132, 191)), radius=4 * SCALE, fill=CHARCOAL)
    return image


def write_svg():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="12" y="12" width="232" height="232" rx="52" fill="#202A32"/>
  <rect x="40" y="68" width="176" height="114" rx="18" fill="#F7FAFC"/>
  <path d="M48 82 128 137 208 82" fill="none" stroke="#BAC6CD" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M102 153v-23a26 26 0 0 1 52 0v23" fill="none" stroke="#21B8A6" stroke-width="16" stroke-linecap="round"/>
  <rect x="90" y="139" width="76" height="71" rx="14" fill="#21B8A6"/>
  <circle cx="128" cy="169" r="9" fill="#202A32"/>
  <rect x="124" y="173" width="8" height="18" rx="4" fill="#202A32"/>
</svg>'''
    (DESKTOP / 'local-outlook-mail-icon.svg').write_text(svg, encoding='utf-8')


def main():
    master = build_master()
    png = master.resize((256, 256), Image.Resampling.LANCZOS)
    png.save(PUBLIC / 'local-outlook-mail-icon.png', optimize=True)
    ico_path = DESKTOP / 'local-outlook-mail.ico'
    master.save(ico_path, format='ICO', sizes=SIZES)
    copyfile(ico_path, PUBLIC / 'favicon.ico')
    write_svg()


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Generate the assets**

Run:

```powershell
python desktop/build-icon.py
```

Expected: five asset files are written with no external downloads.

- [ ] **Step 3: Validate dimensions and alpha**

Run:

```powershell
python -c "from PIL import Image; p=Image.open('public/local-outlook-mail-icon.png'); print(p.size, p.mode); i=Image.open('desktop/local-outlook-mail.ico'); print(i.info.get('sizes'))"
```

Expected: PNG is `(256, 256) RGBA`; ICO lists all seven requested sizes.

### Task 3: Integrate The Icon Into The App And WinExe Build

**Files:**
- Create: `desktop/build-launcher-exe.ps1`
- Modify: `public/index.html`
- Modify: `src/server/index.js`

- [ ] **Step 1: Add the reproducible WinExe build script**

Create `desktop/build-launcher-exe.ps1` that locates the .NET Framework 64-bit C# compiler and runs:

```powershell
& $compiler /nologo /target:winexe /optimize+ `
  /reference:System.dll /reference:System.Windows.Forms.dll `
  "/win32icon:$icon" "/out:$OutputPath" $source
```

Default `OutputPath` is `C:\Users\28589\Desktop\本地Outlook取件台.exe` through `GetFolderPath('Desktop')`.

```powershell
param(
  [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) '本地Outlook取件台.exe')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot 'LocalOutlookLauncher.cs'
$icon = Join-Path $PSScriptRoot 'local-outlook-mail.ico'

foreach ($path in @($compiler, $source, $icon)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required launcher build input is missing: $path" }
}

& $compiler /nologo /target:winexe /optimize+ `
  /reference:System.dll /reference:System.Windows.Forms.dll `
  "/win32icon:$icon" "/out:$OutputPath" $source

if ($LASTEXITCODE -ne 0) { throw "C# compiler failed with exit code $LASTEXITCODE" }
Get-Item -LiteralPath $OutputPath
```

- [ ] **Step 2: Replace the inline favicon**

Replace the current data-URI favicon in `public/index.html` with:

```html
<link rel="icon" type="image/png" sizes="256x256" href="/local-outlook-mail-icon.png" />
<link rel="shortcut icon" href="/favicon.ico" />
```

- [ ] **Step 3: Serve correct MIME types**

Add to `MIME_TYPES` in `src/server/index.js`:

```js
'.png': 'image/png',
'.ico': 'image/x-icon',
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests/exeLauncher.test.js tests/iconAssets.test.js tests/serverApi.test.js
```

Expected: PASS.

### Task 4: Build, Deploy, And Visually Verify

**Files:**
- Update runtime: `D:\LocalOutlookMailConsole\app`
- Replace launcher: `C:\Users\28589\Desktop\本地Outlook取件台.exe`

- [ ] **Step 1: Run the full test suite**

Run `npm test` and expect all tests to pass.

- [ ] **Step 2: Close only the existing local launcher processes**

Identify the desktop WinExe, D-drive Node children, and Edge app process by exact command line. Stop only those PIDs so the desktop EXE can be replaced.

- [ ] **Step 3: Rebuild the portable package**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build-portable.ps1
```

Expected: a new portable directory and ZIP containing the favicon assets and MIME changes.

- [ ] **Step 4: Update the D-drive application**

Copy the rebuilt application contents into `D:\LocalOutlookMailConsole\app`, preserving `D:\LocalOutlookMailConsole\data`, `edge-profile`, and `logs`.

- [ ] **Step 5: Compile and launch the icon-enabled EXE**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build-launcher-exe.ps1
Start-Process "$([Environment]::GetFolderPath('Desktop'))\本地Outlook取件台.exe"
```

- [ ] **Step 6: Verify runtime and icon resources**

Check `/api/health` returns `success=true` and `activeSessions=1`. Extract the associated icon with `System.Drawing.Icon.ExtractAssociatedIcon`, render a 256 px preview, and inspect the 256, 48, 32, and 16 px outputs for transparent corners, a readable white envelope, teal clasp, and dark keyhole.

- [ ] **Step 7: Record artifact hashes**

Record SHA-256 hashes for the desktop EXE, `desktop/local-outlook-mail.ico`, and the rebuilt package ZIP to confirm the deployed artifacts are stable.
