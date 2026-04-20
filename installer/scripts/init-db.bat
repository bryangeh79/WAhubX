@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
:: WAhubX Database Initialization (首次安装)
:: M11 补强 1 · Fresh install 分叉
:: ============================================================

for %%i in ("%~dp0..") do set WAHUBX_HOME=%%~fi

:: 布局: {install}/app/ (代码) + {install}/data/ (持久) + {install}/logs/
set PG_BIN=%WAHUBX_HOME%\app\pgsql\bin
set PG_DATA=%WAHUBX_HOME%\data\pgsql
set NODE=%WAHUBX_HOME%\app\node\node.exe
set BACKEND_DIR=%WAHUBX_HOME%\app\backend
set LOGS_DIR=%WAHUBX_HOME%\logs
set ENV_FILE=%WAHUBX_HOME%\.env

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"
if not exist "%WAHUBX_HOME%\data" mkdir "%WAHUBX_HOME%\data"
if not exist "%WAHUBX_HOME%\data\config" mkdir "%WAHUBX_HOME%\data\config"
if not exist "%WAHUBX_HOME%\data\slots" mkdir "%WAHUBX_HOME%\data\slots"
if not exist "%WAHUBX_HOME%\data\tmp" mkdir "%WAHUBX_HOME%\data\tmp"
if not exist "%WAHUBX_HOME%\data\assets" mkdir "%WAHUBX_HOME%\data\assets"
if not exist "%WAHUBX_HOME%\backups" mkdir "%WAHUBX_HOME%\backups"

:: M7 Day 1 · 债 1.2 · 复制 _builtin 素材 seed 到 data/assets/_builtin
:: 仅 fresh install 跑 (data/assets/_builtin 不存在时)
:: 源: {install}\seeds\_builtin (installer 打包时 build.bat 从 staging 放进来)
:: 目: {install}\data\assets\_builtin
set BUILTIN_SEED=%WAHUBX_HOME%\seeds\_builtin
set BUILTIN_TARGET=%WAHUBX_HOME%\data\assets\_builtin
if not exist "%BUILTIN_TARGET%" (
    if exist "%BUILTIN_SEED%" (
        echo [SEED] Copying _builtin assets from seed to data/assets/_builtin...
        xcopy /s /i /q "%BUILTIN_SEED%" "%BUILTIN_TARGET%" >nul
        echo   _builtin assets seeded.
    ) else (
        echo [WARN] %BUILTIN_SEED% not found · skip seed · M7 asset 池将为空
    )
) else (
    echo [SKIP] _builtin assets already exist · not overwriting
)

:: 从 .env 读端口 + 密码
set PG_PORT=5433
set DB_PASSWORD=
for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("%ENV_FILE%") do (
    if "%%a"=="DB_PORT" set PG_PORT=%%b
    if "%%a"=="DB_PASSWORD" set DB_PASSWORD=%%b
)

echo ========================================
echo   WAhubX Database Initialization
echo   Home: %WAHUBX_HOME%
echo   PG Port: %PG_PORT%
echo ========================================
echo.

if not exist "%PG_BIN%\initdb.exe" (
    echo ERROR: PostgreSQL not found at %PG_BIN%
    echo         installer 打包时需放 portable pg 到 installer/deps/pgsql-portable/
    exit /b 1
)
if not exist "%NODE%" (
    echo ERROR: Node.js not found at %NODE%
    exit /b 1
)

:: ── Step 1: PostgreSQL data dir init ──
if exist "%PG_DATA%\PG_VERSION" goto :skip_initdb

echo [1/5] Initializing PostgreSQL data directory...
"%PG_BIN%\initdb.exe" -D "%PG_DATA%" -U wahubx -E UTF8 --locale=C -A scram-sha-256 --pwfile=<(echo %DB_PASSWORD%) >"%LOGS_DIR%\pgsql-initdb.log" 2>&1
if errorlevel 1 (
    echo ERROR: initdb failed. Check logs\pgsql-initdb.log
    exit /b 1
)

:: pg_hba.conf · local-only · scram-sha-256
echo # WAhubX local-only authentication> "%PG_DATA%\pg_hba.conf"
echo host all all 127.0.0.1/32 scram-sha-256>> "%PG_DATA%\pg_hba.conf"
echo host all all ::1/128 scram-sha-256>> "%PG_DATA%\pg_hba.conf"

:: postgresql.conf 自定义
echo.>> "%PG_DATA%\postgresql.conf"
echo # WAhubX custom settings>> "%PG_DATA%\postgresql.conf"
echo listen_addresses = '127.0.0.1'>> "%PG_DATA%\postgresql.conf"
echo port = %PG_PORT%>> "%PG_DATA%\postgresql.conf"
echo max_connections = 30>> "%PG_DATA%\postgresql.conf"
echo shared_buffers = 128MB>> "%PG_DATA%\postgresql.conf"

echo   PostgreSQL data directory initialized.
goto :start_pg

:skip_initdb
echo [1/5] PostgreSQL data directory already exists, skipping.

:: ── Step 2: start PG ──
:start_pg
echo [2/5] Starting PostgreSQL on port %PG_PORT%...

netstat -an 2>nul | findstr ":%PG_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo WARNING: Port %PG_PORT% already in use
    exit /b 1
)

"%PG_BIN%\pg_ctl.exe" start -D "%PG_DATA%" -l "%LOGS_DIR%\pgsql-init.log" -w -t 30
if errorlevel 1 (
    echo ERROR: PostgreSQL failed to start. Check logs\pgsql-init.log
    type "%LOGS_DIR%\pgsql-init.log" 2>nul
    exit /b 1
)

set RETRIES=0
:waitpg
"%PG_BIN%\pg_isready.exe" -h 127.0.0.1 -p %PG_PORT% -U wahubx >nul 2>&1
if not errorlevel 1 goto :pg_ready
set /a RETRIES+=1
if !RETRIES! gtr 30 (
    echo ERROR: PostgreSQL not ready in time
    "%PG_BIN%\pg_ctl.exe" stop -D "%PG_DATA%" -m fast -w >nul 2>&1
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitpg

:pg_ready
echo   PostgreSQL is ready.

:: ── Step 3: createdb ──
echo [3/5] Creating database 'wahubx'...
set PGPASSWORD=%DB_PASSWORD%
"%PG_BIN%\createdb.exe" -h 127.0.0.1 -p %PG_PORT% -U wahubx wahubx >nul 2>&1
echo   Database ready.

:: ── Step 4: migration ──
echo [4/5] Running database migrations (TypeORM)...
cd /d "%BACKEND_DIR%"
:: TODO (M11 Day 5 smoke): backend 的 dist/database/migrate.js 或 typeorm CLI 路径确认
:: 当前假设 dist 包含 migrate 脚本 · Day 5 build-backend.bat 需确认产出该文件
"%NODE%" dist\database\migrate.js migrate
if errorlevel 1 (
    echo ERROR: Migration failed · check logs/migration-error.log
    cd /d "%WAHUBX_HOME%"
    "%PG_BIN%\pg_ctl.exe" stop -D "%PG_DATA%" -m fast -w >nul 2>&1
    exit /b 1
)
echo   Migrations complete.

:: ── Step 5: seed 默认 tenant/user (fresh install 必需) ──
:: TODO (M11 Day 5 smoke): seed 默认 platform admin · 引导 License Key 输入页
:: 当前 placeholder · 实际 seed 逻辑 Day 5 加 dist/database/seed-first.js

:: ── Step 6: stop PG ──
echo [5/5] Stopping PostgreSQL...
cd /d "%WAHUBX_HOME%"
"%PG_BIN%\pg_ctl.exe" stop -D "%PG_DATA%" -m fast -w >nul 2>&1
echo   PostgreSQL stopped.

echo.
echo ========================================
echo   Fresh install complete! · 桌面图标启动 WAhubX
echo   首次启动后打开浏览器进 License Key 输入页
echo ========================================
exit /b 0
