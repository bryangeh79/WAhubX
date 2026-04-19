@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  WAhubX Backend Build Script (Windows)
::  流程: pnpm install -> nest build -> obfuscate -> stage
::  产物: installer\staging\backend\
:: ============================================================

set PROJECT_ROOT=%~dp0..
set BACKEND_DIR=%PROJECT_ROOT%\packages\backend
set INSTALLER_DIR=%~dp0
set STAGING_DIR=%INSTALLER_DIR%staging\backend

echo ========================================
echo   Building WAhubX Backend
echo ========================================
echo.

:: 1. 装依赖 (workspace 根一次性装所有 package)
echo [1/5] pnpm install (workspace)...
cd /d "%PROJECT_ROOT%"
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo ERROR: pnpm install failed
    exit /b 1
)

:: 2. 编译
echo [2/5] nest build (TypeScript -^> dist)...
call pnpm --filter @wahubx/backend build
if errorlevel 1 (
    echo ERROR: nest build failed
    exit /b 1
)

:: 3. 装 installer 的 obfuscator
echo [3/5] installing javascript-obfuscator...
cd /d "%INSTALLER_DIR%"
if not exist node_modules\javascript-obfuscator (
    call pnpm install --no-frozen-lockfile
    if errorlevel 1 (
        echo ERROR: installer deps install failed
        exit /b 1
    )
)

:: 4. 混淆敏感文件
echo [4/5] obfuscating license / auth / machine-id...
node obfuscate.js --backend-dist "%BACKEND_DIR%\dist"
if errorlevel 1 (
    echo ERROR: obfuscation failed
    exit /b 1
)

:: 5. Stage 到 installer/staging/backend/
echo [5/5] staging -^> %STAGING_DIR%
if exist "%STAGING_DIR%" rmdir /s /q "%STAGING_DIR%"
mkdir "%STAGING_DIR%"

xcopy /E /I /Q /Y "%BACKEND_DIR%\dist"        "%STAGING_DIR%\dist"         >nul
xcopy /E /I /Q /Y "%BACKEND_DIR%\node_modules" "%STAGING_DIR%\node_modules" >nul
copy /Y           "%BACKEND_DIR%\package.json" "%STAGING_DIR%\"             >nul
copy /Y           "%BACKEND_DIR%\.env.example" "%STAGING_DIR%\.env.example" >nul

echo.
echo   ✓ Backend build complete!
echo   → %STAGING_DIR%
echo.
exit /b 0
