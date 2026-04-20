# installer/scripts/verify-deps.ps1
# · release build 前 · 检查所有依赖二进制是否齐全
# · 每项输出 [OK] / [WARN] / [FAIL]

$ErrorActionPreference = 'Continue'
$DepsRoot = Join-Path $PSScriptRoot '..\deps' | Resolve-Path -ErrorAction SilentlyContinue
$AssetsRoot = Join-Path $PSScriptRoot '..\assets' | Resolve-Path -ErrorAction SilentlyContinue
$failures = 0
$warnings = 0

function Write-Status {
    param([string]$Level, [string]$Name, [string]$Detail)
    $color = switch ($Level) {
        'OK'   { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
        'SKIP' { 'Gray' }
        default { 'White' }
    }
    Write-Host ("[{0,-4}] {1,-22} · {2}" -f $Level, $Name, $Detail) -ForegroundColor $color
}

Write-Host "`n=== WAhubX installer deps verify ===`n" -ForegroundColor Cyan

# 1. Node
$nodeExe = Join-Path $DepsRoot 'node-lts-embedded\node.exe'
if (Test-Path $nodeExe) {
    $ver = & $nodeExe --version 2>$null
    Write-Status 'OK' 'node-lts-embedded' "node.exe $ver"
} else {
    Write-Status 'FAIL' 'node-lts-embedded' "缺 $nodeExe · 见 FETCH-DEPS.md §1"
    $failures++
}

# 2. PostgreSQL
$pgExe = Join-Path $DepsRoot 'pgsql-portable\bin\postgres.exe'
if (Test-Path $pgExe) {
    $ver = (& $pgExe --version 2>$null) -replace 'postgres \(PostgreSQL\) ', ''
    Write-Status 'OK' 'pgsql-portable' "postgres.exe v$ver"
} else {
    Write-Status 'FAIL' 'pgsql-portable' "缺 $pgExe · 见 FETCH-DEPS.md §2"
    $failures++
}

# 3. Redis / Memurai
$redisExe = Join-Path $DepsRoot 'redis-windows\redis-server.exe'
$memuraiExe = Join-Path $DepsRoot 'redis-windows\memurai.exe'
if (Test-Path $redisExe) {
    Write-Status 'OK' 'redis-windows' "redis-server.exe found"
} elseif (Test-Path $memuraiExe) {
    Write-Status 'OK' 'redis-windows' "memurai.exe (Redis compat)"
} else {
    Write-Status 'FAIL' 'redis-windows' "缺 · 见 FETCH-DEPS.md §3"
    $failures++
}

# 4. wahubx.ico
$icoPath = Join-Path $AssetsRoot 'wahubx.ico'
if (Test-Path $icoPath) {
    $size = (Get-Item $icoPath).Length
    Write-Status 'OK' 'wahubx.ico' "$size bytes"
} else {
    Write-Status 'WARN' 'wahubx.ico' "产品方未提供 · release 前必补 · FETCH-DEPS.md §4"
    $warnings++
}

# 5. Inno Setup
$iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
if (Test-Path $iscc) {
    Write-Status 'OK' 'Inno Setup 6' 'ISCC.exe installed'
} else {
    Write-Status 'FAIL' 'Inno Setup 6' '未装 · 从 https://jrsoftware.org/isinfo.php 下载'
    $failures++
}

# 6. Piper (可选)
$piperExe = Join-Path $DepsRoot 'piper\piper.exe'
if (Test-Path $piperExe) {
    Write-Status 'OK' 'piper' 'piper.exe found'
    $zhModel = Join-Path $DepsRoot 'piper\voices\zh_CN-huayan-medium.onnx'
    $enModel = Join-Path $DepsRoot 'piper\voices\en_US-amy-medium.onnx'
    if (!(Test-Path $zhModel)) { Write-Status 'WARN' '  zh voice' '缺 huayan-medium'; $warnings++ }
    if (!(Test-Path $enModel)) { Write-Status 'WARN' '  en voice' '缺 amy-medium'; $warnings++ }
} else {
    Write-Status 'SKIP' 'piper' '可选 · 未装 · V1 TTS 自动降级'
}

# 7. build.bat 存在
$buildBat = Join-Path $PSScriptRoot '..\build.bat'
if (Test-Path $buildBat) {
    Write-Status 'OK' 'build.bat' '存在'
} else {
    Write-Status 'FAIL' 'build.bat' '缺 · 参 M11 Day 5 产物'
    $failures++
}

# 8. deps-checksums.txt
$checksumFile = Join-Path $PSScriptRoot '..\deps-checksums.txt'
if (Test-Path $checksumFile) {
    $pendings = (Get-Content $checksumFile | Select-String 'PENDING-FILL').Count
    if ($pendings -eq 0) {
        Write-Status 'OK' 'deps-checksums.txt' 'all filled'
    } else {
        Write-Status 'WARN' 'deps-checksums.txt' "$pendings PENDING · 下载后填"
        $warnings++
    }
} else {
    Write-Status 'FAIL' 'deps-checksums.txt' '缺'
    $failures++
}

# 总结
Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
if ($failures -eq 0 -and $warnings -eq 0) {
    Write-Host "✓ ALL GREEN · release build ready" -ForegroundColor Green
    exit 0
} elseif ($failures -eq 0) {
    Write-Host "⚠ $warnings warnings · dev build OK · release 前补" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "✗ $failures failures · $warnings warnings · cannot build release" -ForegroundColor Red
    exit 1
}
