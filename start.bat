@echo off
title Teaching Platform
color 0A

cd /d "%~dp0"

if not exist ".env" (
    echo ERROR: .env file not found.
    echo Please copy .env.example to .env and fill in your API key and password.
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend && npm install && cd ..
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend && npm install && cd ..
)

echo Starting backend...
start "Teaching Platform - Backend" cmd /k "cd /d "%~dp0backend" && node --experimental-sqlite server.js"

timeout /t 3 /nobreak > nul

echo Starting frontend...
start "Teaching Platform - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

timeout /t 4 /nobreak > nul

start http://localhost:5173
exit
