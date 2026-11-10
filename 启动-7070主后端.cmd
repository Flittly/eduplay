@echo off
chcp 65001 > nul
rem ============================================================
rem  启动 7070 主后端（本地商城 / 安装 / 下载 / 用户端拿包都走它）
rem
rem  ⚠ 必须清掉 SERVER__PORT / SERVER__HOST：
rem     宿主（或本机环境）注入了这两个变量，Spring Boot 的 relaxed binding
rem     会把 SERVER__PORT 当成 server.port ⇒ 服务跑到 50595 去，
rem     然后报 "Port 50595 was already in use" 起不来。
rem  ⚠ 必须在 backend 目录下启动：H2 走相对路径 ./data，
rem     插件包走相对路径 ./plugins/packages，换目录 = 起一个空库。
rem ============================================================
set SERVER__PORT=
set SERVER__HOST=
cd /d "%~dp0backend"
"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe" -jar target\eduplay-backend.jar --server.port=7070 --logging.file.name=backend-run.log
pause
