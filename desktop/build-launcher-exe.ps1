param(
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$fileName = -join @(
  [char]0x672C
  [char]0x5730
  'Outlook'
  [char]0x53D6
  [char]0x4EF6
  [char]0x53F0
  '.exe'
)
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path ([Environment]::GetFolderPath('Desktop')) $fileName
}

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot 'LocalOutlookLauncher.cs'
$icon = Join-Path $PSScriptRoot 'local-outlook-mail.ico'

foreach ($path in @($compiler, $source, $icon)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required launcher build input is missing: $path"
  }
}

& $compiler /nologo /target:winexe /optimize+ `
  /reference:System.dll /reference:System.Windows.Forms.dll `
  "/win32icon:$icon" "/out:$OutputPath" $source

if ($LASTEXITCODE -ne 0) {
  throw "C# compiler failed with exit code $LASTEXITCODE"
}

Get-Item -LiteralPath $OutputPath
