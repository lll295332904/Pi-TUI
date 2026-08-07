@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ================================
echo   Bundle Pi for Tauri Sidecar
echo ================================

set "PI_SRC=%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent"
if not exist "%PI_SRC%\dist" (
    echo ERROR: Pi not found at %PI_SRC%
    echo Run: npm install -g @earendil-works/pi-coding-agent
    exit /b 1
)

set "BUNDLE_DIR=src-tauri\pi-bundle"

rem ------------------------------------------------------------------
rem  Remove previous bundle, with retry.
rem  "Access denied" here is usually a transient file lock:
rem  - a leftover `cargo tauri dev` pi process (node.exe running
rem    from src-tauri\pi-bundle), or
rem  - Windows Defender scanning freshly written node_modules.
rem  We clear read-only attributes, retry a few times, then give a
rem  clear error instead of silently failing robocopy later.
rem ------------------------------------------------------------------
set "REMOVE_ATTEMPT=0"
:remove_retry
set /a REMOVE_ATTEMPT+=1
if exist "%BUNDLE_DIR%" (
    attrib -R "%BUNDLE_DIR%\*" /s >nul 2>&1
    rmdir /s /q "%BUNDLE_DIR%" 2>nul
)
if not exist "%BUNDLE_DIR%" goto :removed_ok
if %REMOVE_ATTEMPT% GEQ 5 goto :remove_failed
echo WARNING: unable to remove %BUNDLE_DIR% (attempt %REMOVE_ATTEMPT%/5), retrying in 2s...
ping -n 3 127.0.0.1 >nul
goto :remove_retry
:remove_failed
echo.
echo ERROR: Could not remove "%BUNDLE_DIR%".
echo Some files inside it are locked by another process.
echo Close any running PiDesk / dev Pi (node.exe under src-tauri)
echo or any Explorer/terminal window open inside that folder, then re-run.
exit /b 1
:removed_ok

mkdir "%BUNDLE_DIR%" >nul 2>&1

rem ------------------------------------------------------------------
rem  Copy helpers: robocopy exits 0-7 on success, 8+ on failure.
rem  Retry a few times to ride out transient AV locks.
rem ------------------------------------------------------------------
set "COPY_ATTEMPT=0"
:dist_copy_retry
set /a COPY_ATTEMPT+=1
robocopy "%PI_SRC%\dist" "%BUNDLE_DIR%\dist" /e /njh /njs /ndl >nul
if !ERRORLEVEL! LSS 8 goto :dist_copy_ok
if %COPY_ATTEMPT% GEQ 3 goto :copy_failed
echo WARNING: robocopy dist failed (exit !ERRORLEVEL!), retrying in 2s...
ping -n 3 127.0.0.1 >nul
goto :dist_copy_retry
:dist_copy_ok
echo Copying Pi dist... OK

echo Copying Pi package metadata...
copy /y "%PI_SRC%\package.json" "%BUNDLE_DIR%\package.json" >nul
if not exist "%BUNDLE_DIR%\package.json" (
    echo ERROR: failed to copy package.json
    exit /b 1
)

set "COPY_ATTEMPT=0"
:nm_copy_retry
set /a COPY_ATTEMPT+=1
robocopy "%PI_SRC%\node_modules" "%BUNDLE_DIR%\node_modules" /e /njh /njs /ndl >nul
if !ERRORLEVEL! LSS 8 goto :nm_copy_ok
if %COPY_ATTEMPT% GEQ 3 goto :copy_failed
echo WARNING: robocopy node_modules failed (exit !ERRORLEVEL!), retrying in 2s...
ping -n 3 127.0.0.1 >nul
goto :nm_copy_retry
:nm_copy_ok
echo Copying Pi dependencies... OK

echo Copying node.exe...
set "NODE_COPIED="
if exist "%APPDATA%\npm\node.exe" (
    copy /y "%APPDATA%\npm\node.exe" "%BUNDLE_DIR%\node.exe" >nul
    set NODE_COPIED=1
) else if exist "C:\Program Files\nodejs\node.exe" (
    copy /y "C:\Program Files\nodejs\node.exe" "%BUNDLE_DIR%\node.exe" >nul
    set NODE_COPIED=1
)
if not defined NODE_COPIED goto :node_missing
if not exist "%BUNDLE_DIR%\node.exe" goto :node_missing
goto :node_ok
:node_missing
echo ERROR: node.exe not found at expected locations
exit /b 1
:node_ok

rem Clear read-only attributes so the next build can delete this bundle cleanly.
attrib -R "%BUNDLE_DIR%\*" /s >nul 2>&1

echo Verifying bundle...
set "HAS_ERROR="
if not exist "%BUNDLE_DIR%\node.exe" set "HAS_ERROR=1"
if not exist "%BUNDLE_DIR%\package.json" set "HAS_ERROR=1"
if not exist "%BUNDLE_DIR%\dist\rpc-entry.js" set "HAS_ERROR=1"
if not exist "%BUNDLE_DIR%\dist\index.js" set "HAS_ERROR=1"
if not exist "%BUNDLE_DIR%\node_modules\" set "HAS_ERROR=1"
if not exist "%BUNDLE_DIR%\node_modules\openai\package.json" set "HAS_ERROR=1"
if defined HAS_ERROR goto :verify_failed
goto :verified_ok
:verify_failed
echo.
echo === BUNDLE VERIFICATION FAILED ===
exit /b 1
:verified_ok

echo.
echo Done. Pi bundled to %BUNDLE_DIR%
echo All critical files verified OK.
exit /b 0
:copy_failed
echo ERROR: robocopy failed copying files
exit /b 1
