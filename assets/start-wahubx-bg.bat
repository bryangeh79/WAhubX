@echo off
chcp 65001 >nul
REM WAhubX background launcher (called by start-wahubx-hidden.vbs)
REM 所有输出重定向到 logs\wahubx-YYYY-MM-DD.log
REM 不要直接双击此文件 · 双击桌面 [启动 WAhubX] 快捷方式

set "PROJ=C:\AI_WORKSPACE\Whatsapp Auto Bot"
set "LOGDIR=%PROJ%\logs"

REM 创建日志目录 (如不存在)
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

REM 日期: YYYY-MM-DD (用 wmic · 不依赖 locale)
for /f "skip=1 tokens=1-3" %%a in ('wmic os get LocalDateTime ^| findstr /b /r "[0-9]"') do (
    set "DT=%%a"
    goto :have_dt
)
:have_dt
set "TODAY=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%"
set "LOGFILE=%LOGDIR%\wahubx-%TODAY%.log"

REM 启动标记
echo ============================================ >> "%LOGFILE%"
echo [%date% %time%] WAhubX BG launcher started   >> "%LOGFILE%"
echo ============================================ >> "%LOGFILE%"

REM 1. Docker check
echo [%date% %time%] [1/2] Docker check... >> "%LOGFILE%"
docker ps 2>nul | findstr "wahubx-dev-pg" >nul
if errorlevel 1 goto start_docker
echo [%date% %time%]       PG already running >> "%LOGFILE%"
goto run_dev

:start_docker
echo [%date% %time%]       Starting PG + Redis (detached)... >> "%LOGFILE%"
cd /d "%PROJ%"
call pnpm.cmd db:up >> "%LOGFILE%" 2>&1
if errorlevel 1 goto err_docker
echo [%date% %time%]       Docker up · waiting 5s for PG... >> "%LOGFILE%"
timeout /t 5 /nobreak >nul
goto run_dev

:run_dev
REM 2. Backend + Frontend 同窗口 concurrently
echo [%date% %time%] [2/2] Starting BE + FE via pnpm dev:all... >> "%LOGFILE%"
cd /d "%PROJ%"
call pnpm.cmd dev:all >> "%LOGFILE%" 2>&1

REM 如果 dev:all 退出 (用户停 / 崩了)
echo [%date% %time%] dev:all exited (errorlevel=%errorlevel%) >> "%LOGFILE%"
exit /b %errorlevel%

:err_docker
echo [%date% %time%] [ERROR] docker compose up failed (Docker Desktop running?) >> "%LOGFILE%"
REM 写错误标记文件 · vbs 检查后弹窗
echo Docker compose up failed > "%LOGDIR%\last-error.txt"
echo Please start Docker Desktop and try again >> "%LOGDIR%\last-error.txt"
exit /b 1
