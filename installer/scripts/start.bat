@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
:: WAhubX 启动脚本 · 后台启 PG + Redis + Backend
:: ============================================================

for %%i in ("%~dp0") do set WAHUBX_HOME=%%~fi

set PG_BIN=%WAHUBX_HOME%\app\pgsql\bin
set PG_DATA=%WAHUBX_HOME%\data\pgsql
set REDIS_BIN=%WAHUBX_HOME%\app\redis
set NODE=%WAHUBX_HOME%\app\node\node.exe
set BACKEND_DIR=%WAHUBX_HOME%\app\backend
set LOGS_DIR=%WAHUBX_HOME%\logs
set ENV_FILE=%WAHUBX_HOME%\.env

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

:: 读端口
set PG_PORT=5433
set REDIS_PORT=6380
set APP_PORT=3000
for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("%ENV_FILE%") do (
    if "%%a"=="DB_PORT" set PG_PORT=%%b
    if "%%a"=="REDIS_PORT" set REDIS_PORT=%%b
    if "%%a"=="PORT" set APP_PORT=%%b
)

echo ========================================
echo   WAhubX starting...
echo   PG=%PG_PORT% · Redis=%REDIS_PORT% · Backend=%APP_PORT%
echo ========================================

:: ── Start PG ──
"%PG_BIN%\pg_isready.exe" -h 127.0.0.1 -p %PG_PORT% >nul 2>&1
if errorlevel 1 (
    echo [1/3] Starting PostgreSQL...
    "%PG_BIN%\pg_ctl.exe" start -D "%PG_DATA%" -l "%LOGS_DIR%\pgsql.log" -w -t 30
    if errorlevel 1 (
        echo ERROR: PG 启动失败 · 见 logs\pgsql.log
        exit /b 1
    )
) else (
    echo [1/3] PostgreSQL 已在跑
)

:: ── Start Redis ──
netstat -an 2>nul | findstr ":%REDIS_PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [2/3] Starting Redis...
    start "WAhubX Redis" /b "%REDIS_BIN%\redis-server.exe" "%REDIS_BIN%\redis.conf" --port %REDIS_PORT% --dir "%LOGS_DIR%" > "%LOGS_DIR%\redis.log" 2>&1
    timeout /t 2 /nobreak >nul
) else (
    echo [2/3] Redis 已在跑
)

:: ── Start Backend ──
netstat -an 2>nul | findstr ":%APP_PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [3/3] Starting Backend on port %APP_PORT%...
    cd /d "%BACKEND_DIR%"
    start "WAhubX Backend" /b "%NODE%" dist\main.js > "%LOGS_DIR%\backend.log" 2>&1
    cd /d "%WAHUBX_HOME%"
    timeout /t 3 /nobreak >nul
) else (
    echo [3/3] Backend 已在跑 (port %APP_PORT%)
)

echo.
echo ========================================
echo   Ready. 打开浏览器: http://localhost:%APP_PORT%
echo ========================================

exit /b 0
