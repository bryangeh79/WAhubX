@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
:: WAhubX 停服脚本 · 按端口停服 · 不按进程名 (CLAUDE.md 铁律)
:: ============================================================

for %%i in ("%~dp0") do set WAHUBX_HOME=%%~fi

set PG_BIN=%WAHUBX_HOME%\app\pgsql\bin
set PG_DATA=%WAHUBX_HOME%\data\pgsql
set ENV_FILE=%WAHUBX_HOME%\.env

set PG_PORT=5434
set REDIS_PORT=6381
set APP_PORT=9700
for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("%ENV_FILE%") do (
    if "%%a"=="DB_PORT" set PG_PORT=%%b
    if "%%a"=="REDIS_PORT" set REDIS_PORT=%%b
    if "%%a"=="PORT" set APP_PORT=%%b
)

echo ========================================
echo   WAhubX stopping...
echo ========================================

:: ── Stop Backend (按 PORT 找 PID 杀) ──
echo [1/3] Stopping Backend on port %APP_PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%APP_PORT% " ^| findstr "LISTENING"') do (
    echo   taskkill PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

:: ── Stop Redis (按 PORT 找 PID 杀) ──
echo [2/3] Stopping Redis on port %REDIS_PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%REDIS_PORT% " ^| findstr "LISTENING"') do (
    echo   taskkill PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

:: ── Stop PG (pg_ctl 优先 · 优雅停) ──
echo [3/3] Stopping PostgreSQL (fast mode)...
"%PG_BIN%\pg_ctl.exe" stop -D "%PG_DATA%" -m fast -w -t 10 >nul 2>&1

echo.
echo ========================================
echo   WAhubX stopped.
echo ========================================

exit /b 0
