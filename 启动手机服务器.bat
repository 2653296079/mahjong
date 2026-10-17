@echo off
chcp 65001 >nul
rem 保留旧入口名称，统一使用自动启动和复用服务的新入口。
call "%~dp0打开联机麻将.bat" "%~1"
