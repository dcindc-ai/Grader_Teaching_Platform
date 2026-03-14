@echo off
title Stopping Teaching Platform
echo Stopping Teaching Platform servers...

:: Kill node processes running on ports 3001 and 5173
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3001" ^| find "LISTENING"') do (
    echo Stopping backend (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do (
    echo Stopping frontend (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Teaching Platform stopped.
timeout /t 2 /nobreak > nul
