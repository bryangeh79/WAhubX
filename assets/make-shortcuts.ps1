$desktop = [Environment]::GetFolderPath('Desktop')
$ico = "C:\AI_WORKSPACE\Whatsapp Auto Bot\assets\wahubx.ico"
$workdir = "C:\AI_WORKSPACE\Whatsapp Auto Bot"

$startBat = $desktop + "\" + [char]0x542F + [char]0x52A8 + " WAhubX.bat"
$startLnk = $desktop + "\" + [char]0x542F + [char]0x52A8 + " WAhubX.lnk"
$stopBat  = $desktop + "\" + [char]0x505C + [char]0x6B62 + " WAhubX.bat"
$stopLnk  = $desktop + "\" + [char]0x505C + [char]0x6B62 + " WAhubX.lnk"

Write-Host "startBat: $startBat · exists=$(Test-Path -LiteralPath $startBat)"
Write-Host "stopBat : $stopBat · exists=$(Test-Path -LiteralPath $stopBat)"

$sh = New-Object -ComObject WScript.Shell

if (Test-Path -LiteralPath $startLnk) { Remove-Item -LiteralPath $startLnk -Force }
$a = $sh.CreateShortcut($startLnk)
$a.TargetPath = $startBat
$a.WorkingDirectory = $workdir
$a.IconLocation = $ico + ",0"
$a.Description = "Start WAhubX dev (1 window · BE+FE merged logs)"
$a.WindowStyle = 1
$a.Save()
Write-Host "启动 .lnk created: $(Test-Path -LiteralPath $startLnk)"

if (Test-Path -LiteralPath $stopLnk) { Remove-Item -LiteralPath $stopLnk -Force }
$b = $sh.CreateShortcut($stopLnk)
$b.TargetPath = $stopBat
$b.WorkingDirectory = $workdir
$b.IconLocation = $ico + ",0"
$b.Description = "Stop WAhubX dev (kill by port 9700/5173)"
$b.WindowStyle = 1
$b.Save()
Write-Host "停止 .lnk created: $(Test-Path -LiteralPath $stopLnk)"
