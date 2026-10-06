@echo off
setlocal EnableExtensions
title EdgeMcp Launcher

rem ============================================================
rem  EdgeMcp one-click launcher
rem  1) Start Edge with the CDP debug port (separate user-data-dir,
rem     does not touch your daily Edge profile)
rem  2) Wait for the debug port to be ready
rem  3) Start edge-mcp as a resident HTTP service:
rem     http://127.0.0.1:7123/mcp
rem  Press Ctrl+C to stop the service; Edge keeps running.
rem ============================================================

rem ---- Config ----
set "CDP_PORT=9222"
set "HTTP_PORT=7123"
set "USER_DATA_DIR=%LOCALAPPDATA%\EdgeMCP"

rem ---- 1. Check Node.js ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node.js ^>= 20 and add it to PATH.
    echo         Download: https://nodejs.org
    pause
    exit /b 1
)

rem ---- 2. Install dependencies on first run ----
if not exist "%~dp0node_modules" (
    echo [INFO] First run detected, running npm install ...
    pushd "%~dp0"
    call npm install
    popd
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your network and retry.
        pause
        exit /b 1
    )
)

rem ---- 3. Locate Edge executable ----
set "EDGE_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_EXE (
    echo [ERROR] Microsoft Edge not found. Edit EDGE_EXE in this script.
    pause
    exit /b 1
)

rem ---- 4. Launch Edge (skip if the port is already listening) ----
curl -s -o nul "http://127.0.0.1:%CDP_PORT%/json/version" 2>nul
if errorlevel 1 (
    echo [1/3] Launching Edge, CDP port %CDP_PORT%, user-data-dir %USER_DATA_DIR% ...
    start "" "%EDGE_EXE%" --remote-debugging-port=%CDP_PORT% --user-data-dir="%USER_DATA_DIR%" --remote-allow-origins=* --no-first-run --no-default-browser-check
) else (
    echo [1/3] Port %CDP_PORT% is already served by an Edge instance, skip launching.
)

rem ---- 5. Wait for the debug port (up to ~30s) ----
echo [2/3] Waiting for Edge CDP port %CDP_PORT% ...
set /a retry=0
:wait_edge
curl -s -o nul "http://127.0.0.1:%CDP_PORT%/json/version" 2>nul
if not errorlevel 1 goto edge_ready
set /a retry+=1
if %retry% geq 30 goto edge_timeout
ping -n 2 127.0.0.1 >nul
goto wait_edge
:edge_timeout
echo [WARN] Port not ready after 30s. Continuing anyway (Edge connection is lazy). Make sure Edge is running with the debug port.
goto server_start
:edge_ready
echo        Edge is ready.

rem ---- 6. Start the MCP HTTP service (foreground) ----
:server_start
echo [3/3] Starting edge-mcp HTTP service: http://127.0.0.1:%HTTP_PORT%/mcp
echo        Health check: http://127.0.0.1:%HTTP_PORT%/health
echo        Press Ctrl+C to stop the service (Edge keeps running).
cd /d "%~dp0"
set "PORT=%HTTP_PORT%"
set "EDGE_CDP_PORT=%CDP_PORT%"
node src\index.js --http

echo.
echo [INFO] Service exited.
pause
