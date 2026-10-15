@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ============================================================
echo   转转麻将 - 公网联机（不在同一个网络也能一起打）
echo ============================================================
echo.
echo [1/2] 先查一下你的公网地址和端口状态...
echo.
node tests\check-public.js 8000
echo.
echo [2/2] 启动服务器。这个窗口要保持开着，关了朋友就掉线。
echo.
echo   朋友打开上面显示的 http://公网IP:8000/ 就能玩，
echo   在页面里点「联机」- 填名字 - 开始对局。
echo.
node server.js 8000
echo.
echo 服务器已停止。按任意键关闭窗口。
pause >nul
