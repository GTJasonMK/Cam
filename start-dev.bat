@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM CodingAgentsManager - One-Click Dev Startup (SQLite mode)
REM
REM Steps:
REM   1. Check runtime dependencies (Node.js, pnpm)
REM   2. Auto-detect available port for web server
REM   3. Install dependencies if needed
REM   4. Build shared package
REM   5. Run database migration + seed
REM   6. Launch Next.js dev server
REM
REM No Docker, PostgreSQL, or Redis needed.
REM SQLite database file: apps/web/data/cam.db
REM ============================================================

set "PROJECT_DIR=%~dp0"

REM Default starting port - auto-incremented if occupied
set "DEFAULT_WEB_PORT=3000"

echo.
echo ============================================================
echo   CodingAgentsManager - Dev Startup (SQLite)
echo ============================================================
echo.

REM ==================== Step 1: Check prerequisites ====================
echo [1/5] Checking prerequisites...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] Node.js not found. Please install Node.js 20+.
    goto :exit_error
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%

where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] pnpm not found. Run: npm install -g pnpm
    goto :exit_error
)
for /f "tokens=*" %%v in ('pnpm --version') do set "PNPM_VER=%%v"
echo   [OK] pnpm %PNPM_VER%

echo.

REM ==================== Step 2: Find available port ====================
echo [2/5] Finding available port...

call :find_port %DEFAULT_WEB_PORT% WEB_PORT
if !WEB_PORT! neq %DEFAULT_WEB_PORT% (
    echo   [INFO] Web: port %DEFAULT_WEB_PORT% in use, using !WEB_PORT!
) else (
    echo   [OK] Web: !WEB_PORT!
)

echo.

REM ==================== Step 3: Install dependencies ====================
echo [3/5] Installing dependencies...

REM Kill any leftover web server window from a previous run
taskkill /fi "WINDOWTITLE eq CAM-Web-Dev" /f >nul 2>&1

REM Only run pnpm install if node_modules is missing
if not exist "%PROJECT_DIR%node_modules" (
    echo   Running pnpm install...
    call pnpm install
    if %errorlevel% neq 0 (
        echo   [FAIL] pnpm install failed.
        goto :exit_error
    )
    echo   [OK] Dependencies installed
) else (
    echo   [OK] Dependencies already installed
)

REM Build shared package (other packages depend on it)
echo   Building shared package...
call pnpm build:shared
if %errorlevel% neq 0 (
    echo   [FAIL] Failed to build shared package.
    goto :exit_error
)
echo   [OK] Shared package built

echo.

REM ==================== Step 4: Database migration + seed ====================
echo [4/5] Initializing database...

echo   Running database migration...
call pnpm db:migrate
if %errorlevel% neq 0 (
    echo   [FAIL] Database migration failed.
    goto :exit_error
)
echo   [OK] Migration complete

echo   Seeding built-in agent definitions...
call pnpm db:seed
if %errorlevel% neq 0 (
    echo   [WARN] Seed failed (may already exist, continuing...)
) else (
    echo   [OK] Seed complete
)

echo.

REM ==================== Step 5: Start web dev server ====================
echo [5/5] Starting web dev server...
echo.
echo ============================================================
echo.
echo   CodingAgentsManager is ready!
echo.
echo   Web UI:    http://localhost:!WEB_PORT!
echo   Database:  apps/web/data/cam.db (SQLite)
echo.
echo   Press any key in this window to stop the server.
echo.
echo ============================================================
echo.

REM Launch Next.js dev server in a separate window
REM PORT env var is read by Next.js automatically
start "CAM-Web-Dev" cmd /c "cd /d "%PROJECT_DIR%" && set PORT=!WEB_PORT! && pnpm --filter @cam/web dev"

REM Block main window until user presses a key
pause >nul

REM ==================== Cleanup ====================
echo.
echo Stopping web server...

REM Close the web server window
taskkill /fi "WINDOWTITLE eq CAM-Web-Dev" /f >nul 2>&1
echo   [OK] Web server stopped

echo.
echo All services stopped. Goodbye.
echo.
goto :eof

REM ==================== Error exit ====================
:exit_error
echo.
echo Startup aborted due to errors above.
echo.
exit /b 1

REM ============================================================
REM Subroutine: find_port
REM   Params: %1 = starting port, %2 = output variable name
REM   Logic:  Scan from starting port upward (max +100 range),
REM           check each with netstat for LISTENING state.
REM           Pattern ":%port%[^0-9]" prevents partial matches
REM           (e.g. searching :5432 won't match :54321).
REM ============================================================
:find_port
set /a "_fp_port=%~1"
set /a "_fp_max=%~1 + 100"
:_fp_check
if %_fp_port% geq %_fp_max% (
    echo   [FAIL] No available port in range %~1-%_fp_max%
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
