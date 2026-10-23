param(
  # JDK 所在目录。缺省用环境变量 JAVA_HOME（64 位链路的原有行为）。
  #
  # 为什么要参数化：32 位运行时**不能**在 64 位 JDK 上用 jlink 交叉产出
  # （jmods 是按平台定制的），必须指向一个真的 32 位 JDK。
  # 好在 32 位 JDK 可以在 64 位 Windows 上正常执行 jlink，换路径即可，不必换机器。
  [string]$JavaHome = $env:JAVA_HOME,
  # 输出目录名（相对 desktop/）。64 位用默认的 runtime，32 位用 runtime-32。
  # 分开放是为了让两条链路互不覆盖：重建 32 位运行时不会把 64 位那份冲掉。
  [string]$Output = 'runtime'
)

$ErrorActionPreference = 'Stop'
$desktopDir = Split-Path -Parent $PSScriptRoot
if (-not $JavaHome) { throw '未指定 JDK：请设置环境变量 JAVA_HOME，或用 -JavaHome 指定 JDK 路径' }
$jlink = Join-Path $JavaHome 'bin\jlink.exe'
if (-not (Test-Path -LiteralPath $jlink)) { throw "找不到 jlink: $jlink" }
$modules = 'java.base,java.desktop,java.compiler,java.instrument,java.logging,java.management,java.naming,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,java.xml,jdk.crypto.ec,jdk.localedata,jdk.unsupported'
$tmp = Join-Path $desktopDir "$Output.tmp"
$runtime = Join-Path $desktopDir $Output
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
Write-Output "==> Building trimmed JRE runtime with jlink"
Write-Output "    JDK:    $JavaHome"
Write-Output "    Output: $Output"
& $jlink --add-modules $modules --strip-debug --no-header-files --no-man-pages --include-locales=en,zh-CN --output $tmp
if ($LASTEXITCODE -ne 0) { throw 'jlink failed' }
if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
Move-Item -LiteralPath $tmp -Destination $runtime
$sizeMB = [math]::Round(((Get-ChildItem -LiteralPath $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Output "Runtime ready: $runtime ($sizeMB MB)"
