# scripts/validate-env.ps1
#
# WAhubX pre-flight check · run before install to confirm machine can run the product
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\validate-env.ps1
#   # or with PowerShell 7: pwsh .\scripts\validate-env.ps1
#
# NOTE: This script uses English only to avoid PowerShell 5.1 UTF-8 BOM parsing issues.
# Chinese documentation is in docs/user-guide/.
#
# Output: 9 checks, each [OK] / [WARN] / [FAIL]
# Exit code: 0 = all green or warn-only, 1 = any FAIL

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
    Write-Host ("[{0,-4}] {1,-26} - {2}" -f $Level, $Name, $Detail) -ForegroundColor $color
}

Write-Host "`n=== WAhubX Pre-flight Check ===`n" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Machine: $env:COMPUTERNAME - User: $env:USERNAME`n"

# 1. Windows version
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) {
    $ver = $os.Version
    $caption = $os.Caption
    if ($ver -match '^10\.') {
        Write-Status 'OK' 'Windows version' "$caption ($ver)"
    } else {
        Write-Status 'WARN' 'Windows version' "$caption - untested - recommend Win10/11"
        $warnings++
    }
} else {
    Write-Status 'FAIL' 'Windows version' 'Cannot detect - confirm not Win7/XP'
    $failures++
}

# 2. RAM
$memGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
if ($memGB -ge 16) {
    Write-Status 'OK' 'RAM' "$memGB GB (recommended)"
} elseif ($memGB -ge 8) {
    Write-Status 'OK' 'RAM' "$memGB GB (minimum OK - multi-account may be tight)"
} else {
    Write-Status 'FAIL' 'RAM' "$memGB GB - minimum 8 GB - product will OOM"
    $failures++
}

# 3. Disk space (C drive)
$cDrive = Get-PSDrive C -ErrorAction SilentlyContinue
if ($cDrive) {
    $freeGB = [math]::Round($cDrive.Free / 1GB, 1)
    if ($freeGB -ge 50) {
        Write-Status 'OK' 'Disk space (C)' "$freeGB GB free"
    } elseif ($freeGB -ge 20) {
        Write-Status 'WARN' 'Disk space (C)' "$freeGB GB - enough to install - clean up later as data grows"
        $warnings++
    } else {
        Write-Status 'FAIL' 'Disk space (C)' "$freeGB GB - minimum 20 GB"
        $failures++
    }
} else {
    Write-Status 'FAIL' 'Disk space (C)' 'C drive not found'
    $failures++
}

# 4. SSD?
try {
    $disk = Get-PhysicalDisk | Where-Object MediaType -eq 'SSD' | Select-Object -First 1
    if ($disk) {
        Write-Status 'OK' 'SSD' "Detected $($disk.FriendlyName)"
    } else {
        Write-Status 'WARN' 'SSD' 'HDD install - backend startup slow - SSD recommended'
        $warnings++
    }
} catch {
    Write-Status 'WARN' 'SSD' 'Cannot detect - manually confirm if SSD'
    $warnings++
}

# 5. Port usage
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
        Write-Status 'WARN' "Port $($p.Name)" "Taken by $procName (PID $procId) - may conflict"
        $warnings++
    } else {
        Write-Status 'OK' "Port $($p.Name)" 'available'
    }
}

# 6. Network reachability (GitHub + VPS - at least one)
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
    Write-Status 'OK' 'Network' 'Internet reachable'
} else {
    Write-Status 'WARN' 'Network' 'Cannot reach github/nodejs - check firewall/proxy'
    $warnings++
}

# 7. Windows Defender / antivirus
try {
    $rt = Get-MpPreference -ErrorAction SilentlyContinue
    if ($rt -and $rt.DisableRealtimeMonitoring) {
        Write-Status 'OK' 'Antivirus' 'Defender real-time off - OK'
    } elseif ($rt) {
        Write-Status 'WARN' 'Antivirus' 'Defender real-time on - recommend whitelist WAhubX folder'
        $warnings++
    } else {
        Write-Status 'WARN' 'Antivirus' 'Cannot detect Defender - manually confirm whitelisted'
        $warnings++
    }
} catch {
    Write-Status 'WARN' 'Antivirus' 'Not admin - cannot detect - manually confirm'
    $warnings++
}

# 8. PowerShell version
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -ge 5) {
    Write-Status 'OK' 'PowerShell' "v$psVer"
} else {
    Write-Status 'WARN' 'PowerShell' "v$psVer - recommend 5.1+"
    $warnings++
}

# 9. .NET Framework (PG portable may need)
try {
    $dotnet = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if ($dotnet -and $dotnet.Release -ge 461808) {
        Write-Status 'OK' '.NET Framework' "$($dotnet.Version) (release $($dotnet.Release))"
    } elseif ($dotnet) {
        Write-Status 'WARN' '.NET Framework' "$($dotnet.Version) - recommend 4.7.2+"
        $warnings++
    } else {
        Write-Status 'WARN' '.NET Framework' 'Not installed 4.x - Win10 usually bundled'
        $warnings++
    }
} catch {
    Write-Status 'WARN' '.NET Framework' 'Cannot detect'
    $warnings++
}

# Summary
Write-Host "`n=== Pre-flight Result ===" -ForegroundColor Cyan
if ($failures -eq 0 -and $warnings -eq 0) {
    Write-Host "[PASS] All checks passed - ready to install" -ForegroundColor Green
    exit 0
} elseif ($failures -eq 0) {
    Write-Host "[WARN] $warnings warning(s) - can install - fix recommended" -ForegroundColor Yellow
    Write-Host "       (can still install but may hit related issues)"
    exit 0
} else {
    Write-Host "[FAIL] $failures failure(s), $warnings warning(s) - do not install" -ForegroundColor Red
    Write-Host "       See docs/user-guide/TROUBLESHOOTING.md section 2 (or 04-troubleshooting.md in pilot kit)"
    exit 1
}
