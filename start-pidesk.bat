@echo off
cd /d "%~dp0"

set "PATH=%APPDATA%\npm;%PATH%"

:: Verify Pi
where pi >nul 2>&1
if errorlevel 1 (
    echo [PiDesk] pi not found. Run: npm install -g @earendil-works/pi-coding-agent
    pause
    exit /b 1
)

echo [PiDesk] Building frontend...
set SAFE_DELETE_DISABLE=1
call npx vite build
if errorlevel 1 (
    echo [PiDesk] Build failed
    pause
    exit /b 1
)

echo [PiDesk] Starting PiDesk...
set SAFE_DELETE_DISABLE=1
npx tauri dev
pause
