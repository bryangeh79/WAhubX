# 打开当天的 WAhubX 日志文件
# 桌面快捷方式 [WAhubX 日志] 调用此文件 (通过 powershell -File 调起)

$logDir = 'C:\AI_WORKSPACE\Whatsapp Auto Bot\logs'
$today = Get-Date -Format 'yyyy-MM-dd'
$todayLog = Join-Path $logDir "wahubx-$today.log"

# 1. 优先开当天日志
if (Test-Path $todayLog) {
    Start-Process notepad $todayLog
    exit 0
}

# 2. 当天没有 · 找最新一个 .log
if (Test-Path $logDir) {
    $latest = Get-ChildItem -Path $logDir -Filter 'wahubx-*.log' -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 1
    if ($latest) {
        Start-Process notepad $latest.FullName
        exit 0
    }
}

# 3. 完全没日志 · 弹个说明文件
$tmp = Join-Path $env:TEMP 'wahubx-no-log.txt'
@(
    'WAhubX 日志目录还没生成日志文件.'
    ''
    "查找位置: $logDir"
    ''
    '可能原因:'
    '  1. WAhubX 还没启动过 · 双击 [启动 WAhubX] 试试'
    '  2. 启动失败但来不及写日志 · 看桌面有没有错误对话框'
    '  3. 日志目录被删了 · 重新双击 [启动 WAhubX] 会自动重建'
) | Set-Content -Path $tmp -Encoding UTF8
Start-Process notepad $tmp
