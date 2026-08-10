@echo off
title MR Shooter - Dev Server

echo.
echo ============================================
echo   MR Shooter WebXR - Dev Server
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo.
    echo Please install Node.js from:
    echo   https://nodejs.org/
    echo   * Choose the LTS version
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo Node.js %NODE_VER% detected.

:: Move to project root
cd /d "%~dp0"

:: Run npm install if node_modules is missing
if not exist "node_modules" (
    echo.
    echo [SETUP] First-time setup - please wait...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
    echo Setup complete!
)

:: Start dev server
echo.
echo ============================================
echo   Starting server...
echo ============================================
echo.
echo   Access the app at:
echo.
echo     This PC   : https://localhost:5173
echo     Meta Quest: https://[this PC's IP]:5173
echo               (see "Network" URL below)
echo.
echo   If browser shows "Connection not private",
echo   click "Advanced" then "Proceed".
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

npm run dev

echo.
echo Server stopped.
pause
