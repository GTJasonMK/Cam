@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM  CAM - dev.bat
REM  Start development server (Web + optional Worker)
REM
REM  Usage:  dev.bat [--all]
REM    (default)   Web only (Next.js custom server)
REM    --all       Web + Worker via Turbo
REM
REM  Configurable parameters:
REM ============================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM --- Configurable ---
set "DEFAULT_PORT=3000"
set "MODE=web"

if /i "%~1"=="--all" set "MODE=all"

echo.
echo ============================================================
echo   CAM - Dev Server
echo ============================================================
echo.

REM ==================== Preflight check ====================
if not exist "%PROJECT_DIR%node_modules" (
    echo   [FAIL] Dependencies not installed. Run install.bat first.
    exit /b 1
)

if not exist "%PROJECT_DIR%packages\shared\dist" (
    echo   [WARN] Shared package not built. Building now...
    call pnpm build:shared
    if %errorlevel% neq 0 (
        echo   [FAIL] Shared package build failed. Run install.bat first.
        exit /b 1
    )
)

REM ==================== Find available port ====================
echo [1/2] Finding available port...

call :find_port %DEFAULT_PORT% WEB_PORT
if !WEB_PORT! neq %DEFAULT_PORT% (
    echo   [INFO] Port %DEFAULT_PORT% in use, using !WEB_PORT!
) else (
    echo   [OK] Port !WEB_PORT!
)

echo.

REM ==================== Kill previous dev server ====================
taskkill /fi "WINDOWTITLE eq CAM-Dev-Web" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq CAM-Dev-All" /f >nul 2>&1

REM ==================== Start dev server ====================
echo [2/2] Starting dev server (mode: %MODE%)...
echo.
echo ============================================================
echo.
echo   CAM is starting...
echo.
echo   Web UI:    http://localhost:!WEB_PORT!
echo   Database:  apps\web\data\cam.db
echo   Mode:      %MODE%
echo.
echo   Press Ctrl+C or close this window to stop.
echo.
echo ============================================================
echo.

set "PORT=!WEB_PORT!"

if "%MODE%"=="all" (
    title CAM-Dev-All
    call pnpm dev
) else (
    title CAM-Dev-Web
    call pnpm --filter @cam/web dev
)

REM If we reach here, server exited
echo.
echo Dev server stopped.
exit /b 0

REM ============================================================
REM Subroutine: find_port
REM   %1 = starting port, %2 = output variable name
REM ============================================================
:find_port
set /a "_fp_port=%~1"
set /a "_fp_max=%~1 + 100"
:_fp_check
if %_fp_port% geq %_fp_max% (
    echo   [WARN] No free port in range %~1-%_fp_max%, using %~1
    set "%~2=%~1"
    goto :eof
)
netstat -ano 2>nul | findstr "LISTENING" | findstr /r ":%_fp_port%[^0-9]" >nul 2>&1
if %errorlevel%==0 (
    set /a "_fp_port+=1"
    goto :_fp_check
)
set "%~2=%_fp_port%"
goto :eof
