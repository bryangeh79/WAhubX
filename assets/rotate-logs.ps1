# WAhubX 日志轮转 · 删 14 天前的 .log 文件
# 由 start-wahubx-hidden.vbs 启动时调用 (异步 · 不阻塞)
# 也可手动跑: powershell -ExecutionPolicy Bypass -File rotate-logs.ps1

$logDir = "C:\AI_WORKSPACE\Whatsapp Auto Bot\logs"
$keepDays = 14

if (-not (Test-Path $logDir)) {
    Write-Host "Log dir does not exist · skip rotate"
    exit 0
}

$cutoff = (Get-Date).AddDays(-$keepDays)
$old = Get-ChildItem -Path $logDir -Filter "wahubx-*.log" -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -lt $cutoff }

if ($old.Count -eq 0) {
    Write-Host "No old logs to rotate (keep $keepDays days · cutoff $($cutoff.ToString('yyyy-MM-dd')))"
    exit 0
}

foreach ($f in $old) {
    try {
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
        Write-Host "Removed: $($f.Name)"
    } catch {
        Write-Warning "Failed to remove $($f.Name): $($_.Exception.Message)"
    }
}

Write-Host "Rotated $($old.Count) old log file(s)"
