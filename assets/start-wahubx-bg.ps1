# WAhubX background launcher · 由 start-wahubx-hidden.vbs 调用
# 不要直接双击 · 双击桌面 [启动 WAhubX] 快捷方式
#
# 流程:
#   1. 创建 logs 目录
#   2. 检查 Docker · 没起就 db:up
#   3. 跑 pnpm dev:all (concurrently BE + FE)
#   4. 全部输出 (stdout + stderr) 重定向到 logs\wahubx-YYYY-MM-DD.log

$ErrorActionPreference = 'Continue'
# PS5+: native command 写 stderr 不当 error · 避免 docker compose 进度信息变红色 NativeCommandError
$PSNativeCommandUseErrorActionPreference = $false
$proj = 'C:\AI_WORKSPACE\Whatsapp Auto Bot'
$logDir = Join-Path $proj 'logs'
$today = Get-Date -Format 'yyyy-MM-dd'
$logFile = Join-Path $logDir "wahubx-$today.log"
$errFile = Join-Path $logDir 'last-error.txt'

# 1. 创建 logs 目录
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# 删旧 last-error.txt (避免误判)
if (Test-Path $errFile) { Remove-Item $errFile -Force -ErrorAction SilentlyContinue }

# Helper · 写日志一行带时间戳
function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Log '============================================'
Log 'WAhubX BG launcher started (PowerShell)'
Log '============================================'

# 2. Docker check
Log '[1/2] Docker check (PG + Redis)...'
Set-Location $proj
$dockerPs = & docker ps 2>&1 | Out-String
if ($dockerPs -match 'wahubx-dev-pg') {
    Log '       PG already running'
} else {
    Log '       Starting PG + Redis (detached)...'
    $up = & pnpm.cmd db:up 2>&1 | Out-String
    Add-Content -Path $logFile -Value $up -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        Log "[ERROR] docker compose up failed (exit=$LASTEXITCODE)"
        Set-Content -Path $errFile -Value "Docker compose up failed`r`nPlease start Docker Desktop and try again`r`n(see $logFile for details)" -Encoding UTF8
        exit 1
    }
    Log '       Docker up · waiting 5s for PG to be ready...'
    Start-Sleep -Seconds 5
}

# 3. Backend + Frontend 同时跑
Log '[2/2] Starting BE + FE via pnpm dev:all (concurrently)...'
Log "       Output → $logFile"

# 关键: pnpm dev:all 会持续跑 · 输出全部追加到 logFile
# 用 Start-Process 避免阻塞被父进程结束影响 · 但我们其实就是要这个进程持续跑
# 改用直接 invoke + 管道追加文件 · 简单可靠

try {
    & pnpm.cmd dev:all 2>&1 | ForEach-Object {
        Add-Content -Path $logFile -Value $_ -Encoding UTF8
    }
    Log "dev:all exited (errorlevel=$LASTEXITCODE)"
} catch {
    Log "[EXCEPTION] $($_.Exception.Message)"
    Set-Content -Path $errFile -Value "Backend/Frontend launch failed:`r`n$($_.Exception.Message)`r`n(see $logFile)" -Encoding UTF8
    exit 1
}
