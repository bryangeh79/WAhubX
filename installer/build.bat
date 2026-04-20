@echo off
REM ============================================================
REM WAhubX Installer Build Script (Day 1.5 · 骨架版)
REM ============================================================
REM  完整版由 M11 Day 3-4 交付. 本 Day 1.5 只做:
REM    1. 检查 deps/ 二进制齐全 (不齐则报错指引用户手动放)
REM    2. 跑 iscc.exe 编译 .iss → output/WAhubX-Setup-v*.exe
REM
REM  Day 3-4 要补的步骤 (TODO 标记):
REM    - 调 build-backend.bat · 拷 dist/ + node_modules/ 到 staging/backend/
REM    - 调 build-frontend.bat · 拷 vite dist/ 到 staging/frontend/
REM    - 拷 deps/node-lts-embedded/* → staging/node/
REM    - 拷 deps/pgsql-portable/* → staging/pgsql/
REM    - 拷 deps/redis-windows/* → staging/redis/
REM    - 拷 scripts/*.bat + scripts/*.js → scripts/ (已就绪时)
REM
REM Prerequisite:
REM    Inno Setup 6.x · 安装后 iscc.exe 默认路径:
REM        %ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
REM        %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
REM ============================================================

setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo [M11 Day 1.5] WAhubX Installer Build (Skeleton)
echo ============================================================

REM ── 查找 iscc.exe ──────────────────────────────────────
set ISCC_EXE=
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set ISCC_EXE=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set ISCC_EXE=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe

if "!ISCC_EXE!"=="" (
    echo [ERROR] Inno Setup 6 not found.
    echo         Install from https://jrsoftware.org/isinfo.php
    echo         Expected path: %%ProgramFiles^(x86^)%%\Inno Setup 6\ISCC.exe
    exit /b 1
)

echo [OK] iscc.exe found: !ISCC_EXE!
echo.

REM ── 检查 staging 目录 ──────────────────────────────────
if not exist "staging" mkdir "staging"
if not exist "output" mkdir "output"
if not exist "assets" mkdir "assets"
if not exist "deps" mkdir "deps"
if not exist "scripts" mkdir "scripts"

REM ── Day 1.5 骨架: staging 内容允许空 ─────────────────
REM     .iss 的 Check: StagingExists() 过滤未就绪的 [Files] 条目
REM     Day 3-4 build.bat 真填 staging/* 后 · 条目自动启用
echo [INFO] staging/ contents (Day 1.5 · 允许为空):
dir /b staging\ 2>nul
echo.

REM ── Day 1.5 assets 检查 · ICO 文件可选 ──────────────────
if not exist "assets\wahubx.ico" (
    echo [WARN] assets\wahubx.ico 不存在 · Inno Setup 会报错
    echo         临时: 手动放任意 .ico 到 assets\ · 或注释掉 .iss 中 SetupIconFile 行
    echo         Day 3+: 产品方交付正式品牌图标
    REM 继续构建 · 让 iscc.exe 自己报错用户决定
)

REM ── 编译 ──
echo [BUILD] iscc.exe wahubx-setup.iss
"!ISCC_EXE!" /Qp wahubx-setup.iss
if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] iscc.exe exit code !ERRORLEVEL!
    exit /b !ERRORLEVEL!
)

echo.
echo [OK] Build complete. Output:
dir /b output\*.exe
echo.
echo ============================================================
echo   Day 1.5 骨架版 · staging 空 · installer 能生成但跑起来无服务
echo   Day 3-4 填 staging/backend + staging/frontend + deps/ 后才可真安装
echo ============================================================

endlocal
