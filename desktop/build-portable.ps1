$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputsRoot = Join-Path $projectRoot 'outputs'
$stageRoot = Join-Path $outputsRoot 'local-outlook-desktop-app'
$archivePath = Join-Path $outputsRoot 'local-outlook-desktop-app.zip'
$nodePath = (Get-Command node).Source

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $outputsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stageRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'runtime') | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $stageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $stageRoot
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stageRoot 'runtime\node.exe')
Copy-Item -Path (Join-Path $projectRoot 'desktop\*.cmd') -Destination $stageRoot

Push-Location $stageRoot
try {
  npm ci --omit=dev --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
Write-Output $archivePath
