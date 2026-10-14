@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 推送到 GitHub - 转转麻将
cd /d "%~dp0"

set REPO_URL=https://github.com/2653296079/mahjong.git
set PAGES_URL=https://2653296079.github.io/mahjong/

echo.
echo ============================================================
echo   把「转转麻将」推送到 GitHub
echo   仓库: %REPO_URL%
echo ============================================================
echo.

where git >nul 2>nul
if not %errorlevel%==0 (
  echo [错误] 没有找到 git 命令。
  echo.
  echo   请先安装 Git for Windows: https://git-scm.com/download/win
  echo   安装时一路默认即可，装完关掉本窗口、重新双击本文件。
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('git --version') do echo   [环境] %%v
echo.

if not exist ".git" (
  echo   [1/6] 初始化本地仓库...
  git init -q
) else (
  echo   [1/6] 已是本地仓库，跳过初始化
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo   [2/6] 绑定远程仓库...
  git remote add origin %REPO_URL%
) else (
  echo   [2/6] 更新远程地址...
  git remote set-url origin %REPO_URL%
)

git config --get user.email >nul 2>nul
if errorlevel 1 (
  git config user.email "mahjong@local"
  git config user.name "mahjong"
  echo   [3/6] 已设置本地提交身份
) else (
  echo   [3/6] 使用已有提交身份
)

echo   [4/6] 加入文件...
git add -A
git status --short
echo.

echo   [5/6] 提交...
git commit -m "add zhuanzhuan mahjong game" >nul 2>nul
if errorlevel 1 (
  echo         没有新变化，跳过提交
) else (
  echo         提交完成
)
git branch -M main

echo   [6/6] 推送到 GitHub...
echo.
echo    ^>^> 如果弹出登录窗口，请登录 GitHub 授权（只需一次）
echo.
git push -u origin main
if errorlevel 1 (
  echo.
  echo [失败] 推送没有成功，常见原因：
  echo    1. 没登录 GitHub —— 重跑一次，在弹窗里完成登录
  echo    2. 网络不通 —— 多试几次，或给 git 配代理
  echo    3. 仓库地址不对 —— 检查 %REPO_URL%
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   推送成功！
echo ============================================================
echo.
echo   下一步：开启 GitHub Pages
echo     1. 浏览器打开 %REPO_URL%
echo     2. Settings -^> 左侧 Pages
echo     3. Source 选 Deploy from a branch
echo     4. Branch 选 main，文件夹选 / (root)，点 Save
echo     5. 等 1~2 分钟后，访问：
echo.
echo        %PAGES_URL%
echo.
echo   手机用 Safari / Chrome 打开这条链接，加到主屏幕就是 App。
echo.
pause