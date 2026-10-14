@echo off
chcp 65001 >nul
title 转转麻将 - 手机访问服务器
cd /d "%~dp0"
set PORT=8000

echo.
echo ============================================================
echo    转转麻将 - 启动手机访问服务器
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  echo  [启动方式] Node.js
  echo.
  node "%~dp0server.js" %PORT%
  goto end
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo  [启动方式] Python
  echo.
  echo  手机上打开： http://[这台电脑的IP]:%PORT%/
  echo  ^(在命令行输入 ipconfig 可以查到 IPv4 地址^)
  echo.
  python -m http.server %PORT%
  goto end
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo  [启动方式] Python launcher
  py -m http.server %PORT%
  goto end
)

echo  没有找到 Node.js 或 Python，无法启动服务器。
echo.
echo  两个办法（任选一个）：
echo    1. 安装 Node.js： https://nodejs.org/  然后重新双击本文件
echo    2. 不用电脑：手机装 a-Shell（免费），在里面执行
echo         python3 -m http.server 8000
echo       再用 Safari 打开 http://localhost:8000/
echo.

:end
echo.
echo  服务器已停止。按任意键关闭窗口。
pause >nul
