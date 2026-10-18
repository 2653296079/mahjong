@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0server\launcher.js" 8192 --no-open
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8192/?build=v32&view=3d&play=1"
