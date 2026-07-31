@echo off
cd /d "%~dp0.."

echo ================================
echo   Bundle Pi for Tauri Sidecar
echo ================================

set "PI_SRC=%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent"
if not exist "%PI_SRC%\dist" (
    echo ERROR: Pi not found at %PI_SRC%
    echo Run: npm install -g @earendil-works/pi-coding-agent
    pause & exit /b 1
)

set "BUNDLE_DIR=src-tauri\pi-bundle"
if exist "%BUNDLE_DIR%" rmdir /s /q "%BUNDLE_DIR%"
mkdir "%BUNDLE_DIR%"

echo Copying Pi dist...
robocopy "%PI_SRC%\dist" "%BUNDLE_DIR%\dist" /e /njh /njs /ndl >nul

echo Copying Pi dependencies...
robocopy "%PI_SRC%\node_modules" "%BUNDLE_DIR%\node_modules" /e /njh /njs /ndl >nul

echo Copying node.exe...
if exist "%PI_SRC%\..\node.exe" (
    copy /y "%PI_SRC%\..\node.exe" "%BUNDLE_DIR%\node.exe" >nul
) else if exist "C:\Program Files\nodejs\node.exe" (
    copy /y "C:\Program Files\nodejs\node.exe" "%BUNDLE_DIR%\node.exe" >nul
) else (
    echo WARNING: node.exe not found, using system Node.js
)

echo Creating launcher...
> "%BUNDLE_DIR%\pi-launcher.cmd" echo @echo off
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo set "DIR=%%~dp0"
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo if exist "%%DIR%%node.exe" (
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo     "%%DIR%%node.exe" "%%DIR%%dist\index.js" %%*
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo ^) else (
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo     node "%%DIR%%dist\index.js" %%*
>>"%BUNDLE_DIR%\pi-launcher.cmd" echo ^)

echo.
echo Done. Pi bundled to %BUNDLE_DIR%
