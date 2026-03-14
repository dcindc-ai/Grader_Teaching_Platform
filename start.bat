@echo off
title Teaching Platform
color 0A

echo ================================================
echo   Teaching Platform - Starting up...
echo ================================================
echo.

:: Find the script's directory (works regardless of where shortcut is)
cd /d "%~dp0"

:: Check .env exists
if not exist ".env" (
    echo ERROR: .env file not found.
    echo Please copy .env.example to .env and add your API key.
    echo.
    pause
    exit /b 1
)

:: Check node_modules exist
if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend
    npm install
    cd ..
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend
    npm install
    cd ..
)

echo Starting backend server...
start "Teaching Platform - Backend" cmd /k "cd /d "%~dp0backend" && node server.js"

:: Brief pause to let backend initialize
timeout /t 2 /nobreak > nul

echo Starting frontend...
start "Teaching Platform - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: Wait for frontend to compile
timeout /t 3 /nobreak > nul

echo.
echo ================================================
echo   Opening Teaching Platform in your browser...
echo ================================================
echo.
echo To stop the platform, close the two terminal windows.
echo.

start http://localhost:5173

exit
