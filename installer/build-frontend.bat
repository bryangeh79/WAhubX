@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  WAhubX Frontend Build Script (Windows)
::  流程: pnpm install -> vite build -> stage
::  产物: installer\staging\frontend\ (纯静态, 给 Nest ServeStatic 托管)
:: ============================================================

set PROJECT_ROOT=%~dp0..
set FRONTEND_DIR=%PROJECT_ROOT%\packages\frontend
set INSTALLER_DIR=%~dp0
set STAGING_DIR=%INSTALLER_DIR%staging\frontend

echo ========================================
echo   Building WAhubX Frontend
echo ========================================
echo.

:: 1. 装依赖 (workspace 根)
echo [1/3] pnpm install (workspace)...
cd /d "%PROJECT_ROOT%"
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo ERROR: pnpm install failed
    exit /b 1
)

:: 2. Vite 构建 (自带 minify + tree-shake; 不需要额外混淆)
echo [2/3] vite build...
call pnpm --filter @wahubx/frontend build
if errorlevel 1 (
    echo ERROR: vite build failed
    exit /b 1
)

:: 3. Stage 到 installer/staging/frontend/
echo [3/3] staging -^> %STAGING_DIR%
if exist "%STAGING_DIR%" rmdir /s /q "%STAGING_DIR%"
mkdir "%STAGING_DIR%"

xcopy /E /I /Q /Y "%FRONTEND_DIR%\dist\*" "%STAGING_DIR%\" >nul

echo.
echo   ✓ Frontend build complete!
echo   → %STAGING_DIR%
echo.
exit /b 0
