@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

rem 访问密钥只保存在你自己电脑的这个文件里：不上传、不进仓库、也不出现在命令行里
set "KEYFILE=%~dp0樱花frp密钥.txt"

rem 允许用参数清空重填：公网联机-樱花frp.bat reset
if /i "%~1"=="reset" (
  if exist "%KEYFILE%" del "%KEYFILE%"
  echo 已清除记住的访问密钥和隧道 ID，重新运行本脚本会再问一次。
  pause
  exit /b 0
)

rem 先把上次记住的读回来
if exist "%KEYFILE%" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%KEYFILE%") do (
    if /i "%%a"=="token" set "NATFRP_TOKEN=%%b"
    if /i "%%a"=="tunnel" set "NATFRP_TARGET=%%b"
  )
)

rem 允许用参数查看记住了什么：公网联机-樱花frp.bat show
if /i "%~1"=="show" (
  echo 配置文件: %KEYFILE%
  if "%NATFRP_TOKEN%"=="" ( echo   访问密钥: 还没记住 ) else ( echo   访问密钥: 已记住 )
  if "%NATFRP_TARGET%"=="" ( echo   隧道 ID : 还没记住 ) else ( echo   隧道 ID : %NATFRP_TARGET% )
  pause
  exit /b 0
)

echo.
echo ============================================================
echo   转转麻将 - 公网联机（樱花 frp 内网穿透）
echo ============================================================
echo.

if not exist "tools\frpc.exe" (
  echo 缺少 tools\frpc.exe，正在从樱花 frp 官方 CDN 下载...
  if not exist tools mkdir tools
  curl.exe -L --fail -o tools\frpc.exe "https://nyat-static.globalslb.net/natfrp/client/frpc/0.51.0-sakura-15/frpc_windows_amd64.exe"
)
if not exist "tools\frpc.exe" (
  echo.
  echo 下载失败，请手动到 https://www.natfrp.com/tunnel/download 下载 frpc 命令行版，
  echo 把 frpc_windows_amd64.exe 放到 tools\frpc.exe 再重试。
  pause
  exit /b 1
)

if not "%NATFRP_TOKEN%"=="" if not "%NATFRP_TARGET%"=="" goto ready

echo 需要两样东西（只需要填这一次，之后会自动记住）：
echo.
echo   1. 访问密钥：浏览器打开 https://www.natfrp.com/user/ 复制「访问密钥」
echo   2. 隧道 ID ：打开 https://www.natfrp.com/tunnel/ 新建一条隧道
echo        隧道类型选 TCP，本地地址 127.0.0.1，本地端口 8000，节点随便挑一个
echo        建好后列表里那串数字就是隧道 ID
echo.
echo   （粘贴后按回车。粘贴时窗口里可能看不到内容，这是正常的）
echo.
if "%NATFRP_TOKEN%"=="" set /p NATFRP_TOKEN=粘贴访问密钥: 
if "%NATFRP_TARGET%"=="" set /p NATFRP_TARGET=填写隧道 ID: 
if "%NATFRP_TOKEN%"=="" goto needmore
if "%NATFRP_TARGET%"=="" goto needmore
echo token=%NATFRP_TOKEN%> "%KEYFILE%"
echo tunnel=%NATFRP_TARGET%>> "%KEYFILE%"
echo.
echo 已记住，下次双击本脚本就不用再填了（存在 樱花frp密钥.txt，想重填就跑 公网联机-樱花frp.bat reset）。
goto ready

:needmore
echo.
echo 没有填完整，已取消。
pause
exit /b 1

:ready
echo.
echo 启动游戏服务器（端口 8000）...
start "转转麻将服务器" /min cmd /c "node server.js 8000"
rem 用 ping 等两秒：timeout 在输入被重定向时会直接失败
ping -n 3 127.0.0.1 >nul
echo.
echo 启动穿透隧道。下面会打印公网地址（形如 cn-xx.natfrp.cloud:12345）。
echo.
echo 注意：樱花 frp 会拦截 HTTP 明文访问（机房合规要求），直接用 http:// 打开会看到 501。
echo 解决办法（只需设置一次）：
echo   1. 打开 https://www.natfrp.com/tunnel/ 编辑这条隧道
echo   2. 把「自动 HTTPS」设为「自动」或「启用」，保存
echo   3. 重启本脚本，然后改用 https:// 开头的地址访问
echo 开了之后浏览器和联机的加密连接都由樱花那边处理，本机不用装证书。
echo.
echo 这个窗口要一直开着；关掉它朋友就连不上了。
echo.

tools\frpc.exe -n

echo.
echo 隧道已断开。按任意键关闭窗口。
pause >nul
