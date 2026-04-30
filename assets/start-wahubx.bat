@echo off
chcp 65001 >nul
REM WAhubX Launcher (single-window concurrently mode)
REM Ports: backend 9700 / frontend 5173 / PG 5434 / Redis 6381
REM Updated 2026-04-30 · 1 cmd window · concurrently merge BE + FE logs
REM Use goto labels (not nested if-block) to avoid cmd parser issue

set "PROJ=C:\AI_WORKSPACE\Whatsapp Auto Bot"

echo.
echo ========================================
echo    WAhubX Launcher (single-window)
echo ========================================
echo.

if not exist "%PROJ%" goto err_noproj

echo [1/2] Docker check (PG + Redis)...
docker ps 2>nul | findstr "wahubx-dev-pg" >nul
if errorlevel 1 goto start_docker
echo       Already running, skip.
goto run_dev

:start_docker
echo       Starting PG + Redis (detached)...
cd /d "%PROJ%"
call pnpm.cmd db:up
if errorlevel 1 goto err_docker
echo       Waiting 5s for PG to be ready...
timeout /t 5 /nobreak >nul
goto run_dev

:run_dev
echo.
echo [2/2] Starting backend + frontend in this window...
echo       Logs prefixed:
echo         [BE] = backend (port 9700)
echo         [FE] = frontend (port 5173)
echo       Browser will open in 30s. Press Ctrl+C once to stop both.
echo.

REM Open browser after 30s in background
start "" /B cmd /c "timeout /t 30 /nobreak >nul && start "" "http://localhost:5173""

cd /d "%PROJ%"
call pnpm.cmd dev:all

echo.
echo ========================================
echo  WAhubX dev session ended.
echo  Docker (PG+Redis) still running. Run "stop-wahubx.bat" to stop fully.
echo ========================================
echo.
pause
exit /b 0

:err_noproj
echo [ERROR] Project path missing: %PROJ%
pause
exit /b 1

:err_docker
echo [ERROR] docker compose up failed (Docker Desktop running?)
pause
exit /b 1
