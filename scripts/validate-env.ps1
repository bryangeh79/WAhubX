# scripts/validate-env.ps1
#
# WAhubX pre-flight check · 客户首次装前跑 · 确认机器能跑
#
# 用法:
#   pwsh .\scripts\validate-env.ps1
#   # 或: powershell -ExecutionPolicy Bypass -File .\scripts\validate-env.ps1
#
# 输出: 9 项检查 · 每项 [OK] / [WARN] / [FAIL]
# Exit code: 0 = 全绿 / 1 = FAIL 存在

$ErrorActionPreference = 'Continue'
$failures = 0
$warnings = 0

function Write-Status {
    param([string]$Level, [string]$Name, [string]$Detail)
    $color = switch ($Level) {
        'OK'   { 'Green' }
        'WARN' { 'Yellow' }
        'FAIL' { 'Red' }
        default { 'White' }
    }
    Write-Host ("[{0,-4}] {1,-26} · {2}" -f $Level, $Name, $Detail) -ForegroundColor $color
}

Write-Host "`n=== WAhubX Pre-flight Check ===`n" -ForegroundColor Cyan
Write-Host "时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "机器: $env:COMPUTERNAME · User: $env:USERNAME`n"

# ── 1. Windows 版本 ──
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) {
    $ver = $os.Version
    $caption = $os.Caption
    if ($ver -match '^10\.') {
        Write-Status 'OK' 'Windows 版本' "$caption ($ver)"
    } else {
        Write-Status 'WARN' 'Windows 版本' "$caption · 未测过 · 推荐 Win10/11"
        $warnings++
    }
} else {
    Write-Status 'FAIL' 'Windows 版本' '无法检测 · 确认不是 Win7/XP'
    $failures++
}

# ── 2. 内存 ──
$memGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if ($memGB -ge 16) {
    Write-Status 'OK' '内存' "$memGB GB (推荐值)"
} elseif ($memGB -ge 8) {
    Write-Status 'OK' '内存' "$memGB GB (最低 OK · 多号可能吃紧)"
} else {
    Write-Status 'FAIL' '内存' "$memGB GB · 最低 8 GB · 产品会 OOM"
    $failures++
}

# ── 3. 硬盘空间 (C 盘) ──
$cDrive = Get-PSDrive C -ErrorAction SilentlyContinue
if ($cDrive) {
    $freeGB = [math]::Round($cDrive.Free / 1GB, 1)
    if ($freeGB -ge 50) {
        Write-Status 'OK' '硬盘空间 (C)' "$freeGB GB free"
    } elseif ($freeGB -ge 20) {
        Write-Status 'WARN' '硬盘空间 (C)' "$freeGB GB · 够装 · 数据增长后需清理"
        $warnings++
    } else {
        Write-Status 'FAIL' '硬盘空间 (C)' "$freeGB GB · 最低 20 GB"
        $failures++
    }
} else {
    Write-Status 'FAIL' '硬盘空间 (C)' 'C 盘不存在?'
    $failures++
}

# ── 4. SSD? ──
try {
    $disk = Get-PhysicalDisk | Where-Object MediaType -eq 'SSD' | Select-Object -First 1
    if ($disk) {
        Write-Status 'OK' 'SSD' "检出 $($disk.FriendlyName)"
    } else {
        Write-Status 'WARN' 'SSD' 'HDD 装机 · backend 启动慢 · 推荐 SSD'
        $warnings++
    }
} catch {
    Write-Status 'WARN' 'SSD' '无法检测 · 手动确认是否 SSD'
    $warnings++
}

# ── 5. 端口占用 ──
$ports = @(
    @{Name='3000 (Backend)'; Port=3000},
    @{Name='5432 (PostgreSQL)'; Port=5432},
    @{Name='6379 (Redis)'; Port=6379}
)
foreach ($p in $ports) {
    $listen = Get-NetTCPConnection -LocalPort $p.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listen) {
        $procId = $listen.OwningProcess
        $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).Name
        Write-Status 'WARN' "端口 $($p.Name)" "已被 $procName (PID $procId) 占 · 安装后可能冲突"
        $warnings++
    } else {
        Write-Status 'OK' "端口 $($p.Name)" 'available'
    }
}

# ── 6. 网络连通 (GitHub + VPS · 至少一个) ──
$urls = @(
    'https://github.com',
    'https://nodejs.org'
)
$anyOk = $false
foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -lt 400) { $anyOk = $true; break }
    } catch {
        # ignore
    }
}
if ($anyOk) {
    Write-Status 'OK' '网络' '外网可通'
} else {
    Write-Status 'WARN' '网络' '无法连 github / nodejs · 检查防火墙 / 代理'
    $warnings++
}

# ── 7. Windows Defender / 杀软 · 建议加白 ──
try {
    $rt = Get-MpPreference -ErrorAction SilentlyContinue
    if ($rt -and $rt.DisableRealtimeMonitoring) {
        Write-Status 'OK' '杀软' 'Defender real-time off · OK'
    } elseif ($rt) {
        Write-Status 'WARN' '杀软' 'Defender real-time on · 建议加 WAhubX 目录白名单'
        $warnings++
    } else {
        Write-Status 'WARN' '杀软' '无法检测 Defender · 手动确认已加白'
        $warnings++
    }
} catch {
    Write-Status 'WARN' '杀软' '非 admin · 无法检测 · 手动确认'
    $warnings++
}

# ── 8. PowerShell 版本 ──
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -ge 5) {
    Write-Status 'OK' 'PowerShell' "v$psVer"
} else {
    Write-Status 'WARN' 'PowerShell' "v$psVer · 推荐 5.1+"
    $warnings++
}

# ── 9. .NET Framework (PG portable 可能需要) ──
try {
    $dotnet = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if ($dotnet -and $dotnet.Release -ge 461808) {
        Write-Status 'OK' '.NET Framework' "$($dotnet.Version) (release $($dotnet.Release))"
    } elseif ($dotnet) {
        Write-Status 'WARN' '.NET Framework' "$($dotnet.Version) · 推荐 4.7.2+"
        $warnings++
    } else {
        Write-Status 'WARN' '.NET Framework' '未装 4.x · Win10 一般自带'
        $warnings++
    }
} catch {
    Write-Status 'WARN' '.NET Framework' '无法检测'
    $warnings++
}

# ── 总结 ──
Write-Host "`n=== Pre-flight 结果 ===" -ForegroundColor Cyan
if ($failures -eq 0 -and $warnings -eq 0) {
    Write-Host "✓ 所有检查通过 · 可以安装" -ForegroundColor Green
    exit 0
} elseif ($failures -eq 0) {
    Write-Host "⚠ $warnings 个 warning · 可以安装 · 建议先处理" -ForegroundColor Yellow
    Write-Host "  (不处理也能跑 · 但可能遇到上述相关问题)"
    exit 0
} else {
    Write-Host "✗ $failures 个 FAIL · 不建议安装 · 请先修复" -ForegroundColor Red
    Write-Host "  $warnings 个 warning"
    Write-Host "  (见 docs/user-guide/TROUBLESHOOTING.md §2)"
    exit 1
}
