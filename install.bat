@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM  CAM - install.bat
REM  Check prerequisites, install dependencies, build shared
REM  package, run database migration and seed.
REM
REM  Usage:  install.bat [--force]
REM    --force   Re-install even if node_modules exists
REM ============================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

set "FORCE=0"
if /i "%~1"=="--force" set "FORCE=1"

echo.
echo ============================================================
echo   CAM - Install
echo ============================================================
echo.

REM ==================== Step 1: Check Node.js ====================
echo [1/6] Checking Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] Node.js not found.
    echo   Please install Node.js 20+ from https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   [OK] Node.js %NODE_VER%

REM Verify Node.js major version >= 20
for /f "tokens=1 delims=v." %%m in ("%NODE_VER%") do set "NODE_MAJOR=%%m"
if %NODE_MAJOR% lss 20 (
    echo   [FAIL] Node.js 20+ required, found %NODE_VER%
    exit /b 1
)

REM ==================== Step 2: Enable corepack + check pnpm ====================
echo [2/6] Checking pnpm...

where corepack >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WARN] corepack not found, trying npm install -g corepack...
    call npm install -g corepack
    if %errorlevel% neq 0 (
        echo   [FAIL] Could not install corepack.
        exit /b 1
    )
)

call corepack enable >nul 2>&1

where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [INFO] pnpm not found, corepack will provide it...
    call corepack prepare pnpm@9.15.0 --activate >nul 2>&1
    where pnpm >nul 2>&1
    if %errorlevel% neq 0 (
        echo   [FAIL] pnpm still not available.
        echo   Run manually: npm install -g pnpm@9
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('pnpm --version') do set "PNPM_VER=%%v"
echo   [OK] pnpm %PNPM_VER%

REM ==================== Step 3: Check native build tools ====================
echo [3/6] Checking native build tools...

REM node-pty and better-sqlite3 require node-gyp / C++ compiler
where python >nul 2>&1
if %errorlevel% neq 0 (
    where python3 >nul 2>&1
    if %errorlevel% neq 0 (
        echo   [WARN] Python not found. Native modules (node-pty, better-sqlite3^)
        echo          may fail to compile. Install Python 3.x or run:
        echo          npm install -g windows-build-tools
    ) else (
        echo   [OK] Python found (python3^)
    )
) else (
    echo   [OK] Python found
)

echo.

REM ==================== Step 4: Install dependencies ====================
echo [4/6] Installing dependencies...

if %FORCE%==0 (
    if exist "%PROJECT_DIR%node_modules" (
        echo   [OK] node_modules exists (use --force to reinstall^)
        goto :skip_install
    )
)

call pnpm install
if %errorlevel% neq 0 (
    echo   [FAIL] pnpm install failed.
    echo   If native modules fail, install Windows Build Tools:
    echo     npm install -g windows-build-tools
    echo   Or install Visual Studio Build Tools with C++ workload.
    exit /b 1
)
echo   [OK] Dependencies installed

:skip_install
echo.

REM ==================== Step 5: Build shared package ====================
echo [5/6] Building shared package...

call pnpm build:shared
if %errorlevel% neq 0 (
    echo   [FAIL] Shared package build failed.
    exit /b 1
)
echo   [OK] @cam/shared built

echo.

REM ==================== Step 6: Database migration + seed ====================
echo [6/6] Initializing database...

echo   Running migration...
call pnpm db:migrate
if %errorlevel% neq 0 (
    echo   [FAIL] Database migration failed.
    exit /b 1
)
echo   [OK] Migration complete

echo   Seeding built-in agents...
call pnpm db:seed
if %errorlevel% neq 0 (
    echo   [WARN] Seed returned non-zero (records may already exist^)
) else (
    echo   [OK] Seed complete
)

echo.
echo ============================================================
echo   Install complete!
echo.
echo   Database: apps\web\data\cam.db
echo   Next:     run dev.bat to start development server
echo ============================================================
echo.

exit /b 0
