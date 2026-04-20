@echo off
REM ============================================================
REM WAhubX Installer Build (M11 Day 5 完整版)
REM ============================================================
REM  步骤:
REM    1. 检查 Inno Setup 6 安装
REM    2. 清空 staging/
REM    3. Build backend (pnpm run build) → copy dist + node_modules to staging/backend/
REM    4. Build frontend (pnpm run build) → copy dist/ to staging/frontend/
REM    5. Copy deps/node-lts-embedded → staging/node/
REM    6. Copy deps/pgsql-portable → staging/pgsql/
REM    7. Copy deps/redis-windows → staging/redis/
REM    8. Copy scripts/*.bat + scripts/*.js → 见 .iss [Files] 引用
REM    9. iscc.exe wahubx-setup.iss → output/WAhubX-Setup-v<ver>.exe
REM
REM  Prerequisite:
REM    - Inno Setup 6 已装 (https://jrsoftware.org/)
REM    - pnpm 在 PATH
REM    - installer/deps/node-lts-embedded/ · pgsql-portable/ · redis-windows/ 齐
REM      (若缺 · 脚本警告但继续 · 生成的 installer 不完整)
REM
REM  使用:
REM    cd installer
REM    build.bat
REM
REM  输出:
REM    output\WAhubX-Setup-v<version>.exe
REM ============================================================

setlocal EnableDelayedExpansion

cd /d "%~dp0"
set INSTALLER_DIR=%cd%
set REPO_ROOT=%INSTALLER_DIR%\..

echo ============================================================
echo [M11 Day 5] WAhubX Installer Build
echo   installer: %INSTALLER_DIR%
echo   repo:      %REPO_ROOT%
echo ============================================================

REM ── 查找 iscc.exe ──
set ISCC_EXE=
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set ISCC_EXE=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set ISCC_EXE=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe

if "!ISCC_EXE!"=="" (
    echo [ERROR] Inno Setup 6 not found.
    echo         Install from https://jrsoftware.org/isinfo.php
    exit /b 1
)
echo [OK] iscc.exe: !ISCC_EXE!

REM ── 找 pnpm ──
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found in PATH
    exit /b 2
)
echo [OK] pnpm found

REM ── 清空 staging ──
echo.
echo [1/9] Cleaning staging/
if exist staging\backend rmdir /s /q staging\backend
if exist staging\frontend rmdir /s /q staging\frontend
if exist staging\node rmdir /s /q staging\node
if exist staging\pgsql rmdir /s /q staging\pgsql
if exist staging\redis rmdir /s /q staging\redis
if not exist staging mkdir staging
if not exist output mkdir output

REM ── Build backend ──
echo.
echo [2/9] Building backend...
cd /d "%REPO_ROOT%\packages\backend"
call pnpm run build
if errorlevel 1 (
    echo [ERROR] backend build failed
    exit /b 3
)
echo [OK] backend dist/ built

REM ── Copy backend ──
echo.
echo [3/9] Copying backend → staging/backend/
mkdir "%INSTALLER_DIR%\staging\backend"
xcopy /s /i /q dist "%INSTALLER_DIR%\staging\backend\dist" >nul
xcopy /s /i /q node_modules "%INSTALLER_DIR%\staging\backend\node_modules" >nul
copy /y package.json "%INSTALLER_DIR%\staging\backend\package.json" >nul
echo [OK] backend staged

REM ── Build frontend ──
echo.
echo [4/9] Building frontend...
cd /d "%REPO_ROOT%\packages\frontend"
call pnpm run build
if errorlevel 1 (
    echo [ERROR] frontend build failed
    exit /b 4
)
echo [OK] frontend dist/ built

REM ── Copy frontend ──
echo.
echo [5/9] Copying frontend → staging/frontend/
mkdir "%INSTALLER_DIR%\staging\frontend"
xcopy /s /i /q dist "%INSTALLER_DIR%\staging\frontend" >nul
echo [OK] frontend staged

REM ── Copy deps (portable binaries) ──
cd /d "%INSTALLER_DIR%"

echo.
echo [6/9] Copying deps/node-lts-embedded → staging/node/
if exist deps\node-lts-embedded (
    xcopy /s /i /q deps\node-lts-embedded staging\node >nul
    echo [OK] node staged
) else (
    echo [WARN] deps\node-lts-embedded missing · see deps\README.md for download
    echo        installer will 生成 but 无 runtime · 仅用于测试 .iss 编译
)

echo.
echo [7/9] Copying deps/pgsql-portable → staging/pgsql/
if exist deps\pgsql-portable (
    xcopy /s /i /q deps\pgsql-portable staging\pgsql >nul
    echo [OK] pgsql staged
) else (
    echo [WARN] deps\pgsql-portable missing
)

echo.
echo [7b/9] Copying deps/redis-windows → staging/redis/
if exist deps\redis-windows (
    xcopy /s /i /q deps\redis-windows staging\redis >nul
    REM 拷 redis.conf (会被 .iss 单独复制一份到 {app}\app\redis)
    if exist scripts\redis.conf copy /y scripts\redis.conf staging\redis\redis.conf >nul
    echo [OK] redis staged
) else (
    echo [WARN] deps\redis-windows missing
)

REM ── Check assets/ icon ──
echo.
echo [8/9] Checking assets/wahubx.ico...
if not exist assets\wahubx.ico (
    echo [WARN] assets\wahubx.ico missing · Inno 会报错
    echo        临时: 从 assets\README.md 指引放任意 .ico
    echo        正式发布: 产品方交付
)

REM ── Run iscc ──
echo.
echo [9/9] Building installer with Inno Setup...
"!ISCC_EXE!" /Qp wahubx-setup.iss
if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] iscc.exe exit code !ERRORLEVEL!
    echo         Common: assets\wahubx.ico 缺 / staging 目录结构不全 / Inno 脚本语法错误
    exit /b 5
)

echo.
echo ============================================================
echo   Build complete. Output:
dir /b output\*.exe
echo ============================================================
echo.
echo Next steps:
echo   1. node scripts/sign-wupd.js genkey   (if no production key yet)
echo   2. Replace WAHUBX_UPDATE_PUBLIC_KEY_HEX in public-key.ts
echo   3. Rebuild installer (this script)
echo   4. Test install on clean VM
echo   5. If ok · distribute .exe

endlocal
