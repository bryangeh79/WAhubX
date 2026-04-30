@echo off
chcp 65001 >nul
REM WAhubX Stopper (pure ASCII)
REM Kill by port -- never -IM node.exe (would kill FAhubX)

echo.
echo ========================================
echo    WAhubX Stopper
echo ========================================
echo.

REM ---- Kill backend (9700) ----
echo [1/3] Stopping backend (port 9700)...
set "killed_be=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "0.0.0.0:9700.*LISTENING"') do (
    echo       kill PID %%a
    taskkill /F /PID %%a >nul 2>&1
    set "killed_be=1"
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:9700.*LISTENING"') do (
    echo       kill PID %%a
    taskkill /F /PID %%a >nul 2>&1
    set "killed_be=1"
)
if "%killed_be%"=="0" (echo       not running) else (echo       OK stopped)

echo.

REM ---- Kill frontend (5173) ----
echo [2/3] Stopping frontend (port 5173)...
set "killed_fe=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "0.0.0.0:5173.*LISTENING"') do (
    echo       kill PID %%a
    taskkill /F /PID %%a >nul 2>&1
    set "killed_fe=1"
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:5173.*LISTENING"') do (
    echo       kill PID %%a
    taskkill /F /PID %%a >nul 2>&1
    set "killed_fe=1"
)
if "%killed_fe%"=="0" (echo       not running) else (echo       OK stopped)

echo.
echo [3/3] Docker (PG + Redis):
choice /C YN /N /M "       Stop Docker too? [Y/N]: "
if errorlevel 2 goto skip_docker
if errorlevel 1 (
    cd /d "C:\AI_WORKSPACE\Whatsapp Auto Bot"
    docker compose -f docker-compose.dev.yml down
    echo       OK Docker stopped
    goto end
)
:skip_docker
echo       Docker kept running (faster restart next time)

:end
echo.
echo ========================================
echo  WAhubX stopped.
echo  Note: only killed PIDs on 9700/5173,
echo        FAhubX (port 9600) NOT touched.
echo ========================================
echo.
pause
