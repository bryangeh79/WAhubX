@echo off
:: ============================================================
:: WAhubX 启动入口 · 用户点桌面图标时执行
:: 启动后自动打开默认浏览器到 http://localhost:<port>
:: ============================================================

for %%i in ("%~dp0") do set WAHUBX_HOME=%%~fi
set ENV_FILE=%WAHUBX_HOME%\.env

:: 读 app port
set APP_PORT=9700
for /f "usebackq eol=# tokens=1,2 delims==" %%a in ("%ENV_FILE%") do (
    if "%%a"=="PORT" set APP_PORT=%%b
)

:: 先启服务 (幂等 · 已跑则跳过)
call "%WAHUBX_HOME%\start.bat"
if errorlevel 1 (
    echo ERROR: 启动失败 · 见 logs\
    pause
    exit /b 1
)

:: 等 backend /health OK (简单轮询 15s)
set /a TRIES=0
:health_check
curl -s -o nul -w "%%{http_code}" http://localhost:%APP_PORT%/api/v1/health 2>nul | findstr "200" >nul
if not errorlevel 1 goto :health_ok
set /a TRIES+=1
if %TRIES% gtr 15 goto :health_timeout
timeout /t 1 /nobreak >nul
goto :health_check

:health_ok
:: 打开浏览器
start "" "http://localhost:%APP_PORT%"
echo WAhubX 已启动 · 浏览器打开 http://localhost:%APP_PORT%
exit /b 0

:health_timeout
echo WARN: backend 启动超时 15s · 仍尝试打开浏览器
start "" "http://localhost:%APP_PORT%"
exit /b 0
