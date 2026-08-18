@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ================================================
echo   Cleanup: remove installed PiDesk + its bundled Pi
echo.
echo   Deletes:
echo     %%LOCALAPPDATA%%\PiDesk          (pidesk.exe,
echo                          pi-bundle v0.84.1, pi-bundle.bak-0.82.0)
echo     %%LOCALAPPDATA%%\com.pidesk.app  (runtime / WebView data)
echo   Keeps:
echo     C:\Git\Pi-TUI  project (self-contained bundle)
echo     C:\Users\nalch\.pi      (config, auth, sessions)
echo ================================================
echo.

:: 1. Stop PiDesk and any pi runtime loaded from its bundle
echo [1/3] Stopping PiDesk / embedded pi runtime...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pidesk.exe' -or $_.CommandLine -like '*PiDesk*pi-bundle*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

:: 2. Delete %%LOCALAPPDATA%%\PiDesk
echo [2/3] Deleting %%LOCALAPPDATA%%\PiDesk ...
set "TARGET=%LOCALAPPDATA%\PiDesk"
set /a ATTEMPT=0
:retry_local
set /a ATTEMPT+=1
if exist "%TARGET%" (
    attrib -R "%TARGET%\*" /s >nul 2>&1
    rmdir /s /q "%TARGET%" 2>nul
)
if not exist "%TARGET%" goto :local_ok
if %ATTEMPT% GEQ 5 goto :local_failed
echo   WARNING: files locked, retry %ATTEMPT%/5...
timeout /t 2 /nobreak >nul
goto :retry_local
:local_ok
echo   OK
goto :com_step
:local_failed
echo   ERROR: could not fully delete %TARGET%
echo   Close any Explorer/terminal window open inside it, then re-run.
:com_step

:: 3. Delete %%LOCALAPPDATA%%\com.pidesk.app
echo [3/3] Deleting %%LOCALAPPDATA%%\com.pidesk.app ...
set "TARGET2=%LOCALAPPDATA%\com.pidesk.app"
set /a ATTEMPT2=0
:retry_com
set /a ATTEMPT2+=1
if exist "%TARGET2%" (
    attrib -R "%TARGET2%\*" /s >nul 2>&1
    rmdir /s /q "%TARGET2%" 2>nul
)
if not exist "%TARGET2%" goto :com_ok
if %ATTEMPT2% GEQ 5 goto :com_failed
echo   WARNING: files locked, retry %ATTEMPT2%/5...
timeout /t 2 /nobreak >nul
goto :retry_com
:com_ok
echo   OK
goto :done
:com_failed
echo   ERROR: could not fully delete %TARGET2%
echo   Make sure PiDesk is closed, then re-run.

:done
echo.
echo Done.
echo Remaining Pi-related items:
echo   - C:\Git\Pi-TUI          (project kept)
echo   - C:\Users\nalch\.pi     (config / sessions kept)
echo.
pause
