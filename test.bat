@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM  CAM - test.bat
REM  Run unit tests and optionally E2E tests
REM
REM  Usage:  test.bat [--e2e] [--all]
REM    (default)   Unit tests only (@cam/web)
REM    --e2e       E2E tests only (Playwright)
REM    --all       Unit + E2E
REM ============================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

set "RUN_UNIT=0"
set "RUN_E2E=0"

if /i "%~1"=="" set "RUN_UNIT=1"
if /i "%~1"=="--e2e" set "RUN_E2E=1"
if /i "%~1"=="--all" (
    set "RUN_UNIT=1"
    set "RUN_E2E=1"
)
REM Default: if no flag matched, run unit
if %RUN_UNIT%==0 if %RUN_E2E%==0 set "RUN_UNIT=1"

echo.
echo ============================================================
echo   CAM - Test Runner
echo ============================================================
echo.

REM ==================== Preflight ====================
if not exist "%PROJECT_DIR%node_modules" (
    echo   [FAIL] Dependencies not installed. Run install.bat first.
    exit /b 1
)

set "EXIT_CODE=0"

REM ==================== Unit Tests ====================
if %RUN_UNIT%==1 (
    echo [Unit] Running @cam/web unit tests...
    echo.

    call pnpm --filter @cam/web test
    if %errorlevel% neq 0 (
        echo.
        echo   [FAIL] Unit tests failed.
        set "EXIT_CODE=1"
    ) else (
        echo.
        echo   [OK] Unit tests passed.
    )
    echo.
)

REM ==================== E2E Tests ====================
if %RUN_E2E%==1 (
    echo [E2E] Running Playwright E2E tests...
    echo.

    REM Check if Playwright browsers are installed
    call npx playwright install --with-deps chromium >nul 2>&1

    call pnpm --filter @cam/web test:e2e
    if %errorlevel% neq 0 (
        echo.
        echo   [FAIL] E2E tests failed.
        set "EXIT_CODE=1"
    ) else (
        echo.
        echo   [OK] E2E tests passed.
    )
    echo.
)

REM ==================== Summary ====================
echo ============================================================
if %EXIT_CODE%==0 (
    echo   All tests passed.
) else (
    echo   Some tests failed. See output above.
)
echo ============================================================
echo.

exit /b %EXIT_CODE%
