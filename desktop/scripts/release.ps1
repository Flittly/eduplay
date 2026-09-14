$ErrorActionPreference = 'Stop'

$desktopDir = Split-Path -Parent $PSScriptRoot
$workspaceDir = Split-Path -Parent $desktopDir

$frontendDir = Join-Path $workspaceDir 'frontend'
$backendDir = Join-Path $workspaceDir 'backend'

Write-Output '==> [0/5] Building trimmed JRE runtime ...'
& (Join-Path $PSScriptRoot 'make-runtime.ps1')
if ($LASTEXITCODE -ne 0) { throw 'runtime build failed' }

Write-Output '==> [1/5] Building teacher frontend ...'
Push-Location $frontendDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
} finally {
  Pop-Location
}

Write-Output '==> [2/5] Packaging local backend jar ...'
Push-Location $backendDir
try {
  mvn -q -DskipTests package
  if ($LASTEXITCODE -ne 0) { throw 'backend package failed' }
} finally {
  Pop-Location
}

if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Output '==> [3/5] Building EduPlay installer ...'
Push-Location $desktopDir
try {
  npm run dist
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder (nsis) failed' }
} finally {
  Pop-Location
}

# Portable build goes to release-portable\ so it never clashes with the installer artifacts.
Write-Output '==> [4/5] Building portable folder ...'
Push-Location $desktopDir
try {
  npm run dist:portable
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder (dir) failed' }
} finally {
  Pop-Location
}

$pkg = Get-Content (Join-Path $desktopDir 'package.json') -Raw | ConvertFrom-Json
$releaseDir = Join-Path $desktopDir 'release'
$installer = Join-Path $releaseDir "EduPlay Setup $($pkg.version).exe"
$portableDir = Join-Path $desktopDir 'release-portable\win-unpacked'

# Drop the portable-mode marker next to the exe. main.js redirects the user data
# directory (local database, cache, login state) to userdata\ beside the exe when
# this marker is present, which is what makes the folder USB-drive portable.
# The marker text is kept in a separate UTF-8 file and copied verbatim, so this
# script stays pure ASCII (PowerShell 5.1 reads BOM-less scripts as ANSI).
$markerSource = Join-Path $desktopDir 'build\portable-marker.txt'
if ((Test-Path -LiteralPath $portableDir) -and (Test-Path -LiteralPath $markerSource)) {
  Copy-Item -LiteralPath $markerSource -Destination (Join-Path $portableDir 'portable.txt') -Force
  Write-Output "Done. Portable folder: $portableDir"
  Write-Output '      (portable.txt copied; copy the whole folder to a USB drive to run)'
} elseif (Test-Path -LiteralPath $portableDir) {
  Write-Output "Warning: marker template not found at $markerSource"
} else {
  Write-Output "Warning: portable folder not found at $portableDir"
}

Write-Output ''
Write-Output "Done. Installer: $installer"
