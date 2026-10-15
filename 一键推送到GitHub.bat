@echo off
setlocal
title Mahjong GitHub Pages Push
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed.
  goto fail
)

if not exist ".git" (
  echo [ERROR] This directory is not a Git repository.
  goto fail
)

for /f "delims=" %%b in ('git branch --show-current') do set BRANCH=%%b
if /I not "%BRANCH%"=="main" (
  echo [STOP] Current branch: %BRANCH%. Review and merge into main first.
  goto fail
)

set DIRTY=
for /f "delims=" %%s in ('git status --porcelain') do set DIRTY=1
if defined DIRTY (
  echo [STOP] Commit local changes before pushing.
  goto fail
)

echo Pushing main to:
git remote get-url origin
echo.
git push origin main
if errorlevel 1 (
  echo [ERROR] Push failed. Check the network, login, and remote branch.
  goto fail
)

echo.
echo [DONE] Wait for GitHub Pages to build, then visit:
echo https://2653296079.github.io/mahjong/
pause
exit /b 0

:fail
echo.
pause
exit /b 1
