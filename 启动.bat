@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found.
  echo   Please install Node.js 18+ from https://nodejs.org/
  echo   ^(Node.js wei an zhuang, qing xian an zhuang hou zhong shi^)
  echo.
  pause
  exit /b 1
)

node "scripts\launcher.mjs"
if errorlevel 1 pause
endlocal
