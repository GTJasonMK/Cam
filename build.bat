@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM  CAM - build.bat
REM  Production build for all packages
REM
REM  Usage:  build.bat [--lint]
REM    (default)   Build shared + web + worker
REM    --lint      Run lint before build
REM
REM  Output:
REM    packages/shared/dist/   - Shared types (ESM + CJS)
REM    apps/web/.next/         - Next.js production build
REM    apps/worker/dist/       - Worker compiled JS
REM ============================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

set "RUN_LINT=0"
if /i "%~1"=="--lint" set "RUN_LINT=1"

echo.
echo ============================================================
echo   CAM - Production Build
echo ============================================================
echo.

REM ==================== Preflight ====================
if not exist "%PROJECT_DIR%node_modules" (
    echo   [FAIL] Dependencies not installed. Run install.bat first.
    exit /b 1
)

REM ==================== Lint (optional) ====================
if %RUN_LINT%==1 (
    echo [Lint] Running linters...
    call pnpm lint
    if %errorlevel% neq 0 (
        echo   [FAIL] Lint errors found. Fix them before building.
        exit /b 1
    )
    echo   [OK] Lint passed
    echo.
)

REM ==================== Build ====================
echo [Build] Building all packages via Turbo...
echo.

call pnpm build
if %errorlevel% neq 0 (
    echo.
    echo   [FAIL] Build failed. See errors above.
    exit /b 1
)

echo.
echo ============================================================
echo   Build complete!
echo.
echo   Output:
echo     packages\shared\dist\   - Shared types
echo     apps\web\.next\         - Next.js production
echo     apps\worker\dist\       - Worker JS
echo.
echo   To start production:
echo     cd apps\web ^&^& node --import tsx server.ts
echo ============================================================
echo.

exit /b 0
