$ErrorActionPreference = 'Stop'

$desktopDir = Split-Path -Parent $PSScriptRoot
$workspaceDir = Split-Path -Parent $desktopDir

$frontendDir = Join-Path $workspaceDir 'frontend'
$backendDir = Join-Path $workspaceDir 'backend'

Write-Output '==> [0/4] Building trimmed JRE runtime ...'
& (Join-Path $PSScriptRoot 'make-runtime.ps1')
if ($LASTEXITCODE -ne 0) { throw 'runtime build failed' }
Write-Output '==> [1/4] Building teacher frontend ...'
Push-Location $frontendDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
} finally {
  Pop-Location
}

Write-Output '==> [2/4] Packaging local backend jar ...'
Push-Location $backendDir
try {
  mvn -q -DskipTests package
  if ($LASTEXITCODE -ne 0) { throw 'backend package failed' }
} finally {
  Pop-Location
}

Write-Output '==> [3/4] Building EduPlay installer ...'
Push-Location $desktopDir
try {
  if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  npm run dist
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }
} finally {
  Pop-Location
}

$installer = Join-Path $desktopDir 'release\EduPlay Setup 1.1.0.exe'
Write-Output ''
Write-Output "Done. Installer: $installer"
