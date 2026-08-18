@echo off
cd /d "%~dp0"

:: Verify bundled Pi runtime (project is self-contained, no global pi needed)
if not exist "src-tauri\pi-bundle\node.exe" (
    echo [PiDesk] Bundled Pi runtime not found at src-tauri\pi-bundle
    echo Run scripts\bundle-pi.bat first (or build-pidesk.bat).
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
npx tauri dev
pause
