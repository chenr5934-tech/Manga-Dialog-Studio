@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

echo.
echo   Manga Dialog Studio - Update
echo   ============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Git not found. Install Git from https://git-scm.com/
  echo   Or download the repo ZIP manually and overwrite this folder,
  echo   keeping your own presets/ stickers/ templates/ config/ uploads/ folders.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo   [SKIP] This folder is not a git checkout, so there is nothing to pull.
  echo   To enable one-click updates, re-download the project with:
  echo       git clone https://github.com/chenr5934-tech/Manga-Dialog-Studio.git
  echo   then move your presets/ stickers/ templates/ config/ uploads/ into it.
  echo.
  pause
  exit /b 0
)

echo   [1/3] Pulling the latest version...
set GIT_TERMINAL_PROMPT=0
for /f "delims=" %%i in ('git rev-parse HEAD') do set OLD_HEAD=%%i
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   [ERROR] Pull failed. Check your network, then run this file again.
  echo   If you have local edits you want to keep, commit or stash them first:
  echo       git stash
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%i in ('git rev-parse HEAD') do set NEW_HEAD=%%i

if "%OLD_HEAD%"=="%NEW_HEAD%" (
  echo   Already up to date.
) else (
  echo   Updated: %OLD_HEAD:~0,7% -^> %NEW_HEAD:~0,7%
)

echo   [2/3] Syncing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo   [ERROR] npm install failed.
  echo.
  pause
  exit /b 1
)

echo   [3/3] Rebuilding...
call npm run build
if errorlevel 1 (
  echo.
  echo   [ERROR] Build failed. See the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. Your presets, stickers, templates, config and uploads are untouched.
echo   Double-click start.bat to start the editor.
echo.
pause
endlocal
