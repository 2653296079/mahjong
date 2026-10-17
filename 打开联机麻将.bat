@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.16 或更高版本。
  pause
  exit /b 1
)
node "%~dp0server\launcher.js" "%~1"
if errorlevel 1 pause
