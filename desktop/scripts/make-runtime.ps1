$ErrorActionPreference = 'Stop'
$desktopDir = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) { throw 'JAVA_HOME 未设置，请先安装 JDK 21 并设置 JAVA_HOME' }
$jlink = Join-Path $env:JAVA_HOME 'bin\jlink.exe'
if (-not (Test-Path -LiteralPath $jlink)) { throw "找不到 jlink: $jlink" }
$modules = 'java.base,java.desktop,java.compiler,java.instrument,java.logging,java.management,java.naming,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,java.xml,jdk.crypto.ec,jdk.localedata,jdk.unsupported'
$tmp = Join-Path $desktopDir 'runtime.tmp'
$runtime = Join-Path $desktopDir 'runtime'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
Write-Output '==> Building trimmed JRE runtime with jlink ...'
& $jlink --add-modules $modules --strip-debug --no-header-files --no-man-pages --include-locales=en,zh-CN --output $tmp
if ($LASTEXITCODE -ne 0) { throw 'jlink failed' }
if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
Move-Item -LiteralPath $tmp -Destination $runtime
$sizeMB = [math]::Round(((Get-ChildItem -LiteralPath $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Output "Runtime ready: $runtime ($sizeMB MB)"


