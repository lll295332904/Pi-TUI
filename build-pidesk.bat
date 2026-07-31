@echo off
cd /d "%~dp0"

echo ================================
echo   PiDesk Release Build
echo ================================
echo.

echo [1/4] Installing frontend dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed
    pause & exit /b 1
)

echo.
echo [2/4] Bundling Pi Agent...
call scripts\bundle-pi.bat
if %errorlevel% neq 0 (
    echo ERROR: Pi bundle failed
    pause & exit /b 1
)

echo.
echo [3/4] Building release (Tauri + Vite)...
echo This takes 3-5 minutes...
echo.
call npx tauri build
if %errorlevel% neq 0 (
    echo ERROR: Build failed
    pause & exit /b 1
)

echo.
echo [4/4] Done!
echo.
echo Output:
echo   MSI installer:  src-tauri\target\release\bundle\msi\PiDesk_*.msi
echo   NSIS installer: src-tauri\target\release\bundle\nsis\PiDesk_*.exe
echo.
echo Release copied to: %~dp0release
if not exist "release" mkdir "release"
for %%f in ("src-tauri\target\release\bundle\nsis\*.exe") do (
    copy /y "%%f" "release\" >nul
    echo   release\%%~nxf
)
echo.
pause
