@echo off
chcp 65001 >nul
REM 打开当天的 WAhubX 日志文件 (用 notepad)
REM 桌面快捷方式 [WAhubX 日志] 调用此文件

set "LOGDIR=C:\AI_WORKSPACE\Whatsapp Auto Bot\logs"

REM 当天日期 YYYY-MM-DD (用 wmic · 不依赖 locale)
for /f "skip=1 tokens=1-3" %%a in ('wmic os get LocalDateTime ^| findstr /b /r "[0-9]"') do (
    set "DT=%%a"
    goto :have_dt
)
:have_dt
set "TODAY=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%"
set "TODAYLOG=%LOGDIR%\wahubx-%TODAY%.log"

REM 优先开当天 · 没有就开最新
if exist "%TODAYLOG%" (
    start "" notepad "%TODAYLOG%"
    exit /b 0
)

REM 没当天日志 · 找最新一个 .log
for /f "delims=" %%f in ('dir /b /od "%LOGDIR%\wahubx-*.log" 2^>nul') do set "LATEST=%%f"

if defined LATEST (
    start "" notepad "%LOGDIR%\%LATEST%"
    exit /b 0
)

REM 完全没有日志 · 弹个对话框
echo. > "%TEMP%\wahubx-nolog.txt"
echo WAhubX 日志目录还没生成日志文件. >> "%TEMP%\wahubx-nolog.txt"
echo 可能原因: >> "%TEMP%\wahubx-nolog.txt"
echo  1. WAhubX 还没启动过 (双击 [启动 WAhubX] 试试) >> "%TEMP%\wahubx-nolog.txt"
echo  2. 日志目录被删: %LOGDIR% >> "%TEMP%\wahubx-nolog.txt"
start "" notepad "%TEMP%\wahubx-nolog.txt"
exit /b 1
