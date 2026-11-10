@echo off
chcp 65001 > nul
rem ============================================================
rem  启动 17070 云端后端（管理端导出包 / 云端商城，MySQL eduplay_cloud）
rem
rem  同样要清 SERVER__PORT / SERVER__HOST，并在 admin-backend 目录下启动
rem  （包文件走相对路径 ./plugins/packages）。
rem ============================================================
set SERVER__PORT=
set SERVER__HOST=
cd /d "%~dp0admin-backend"
"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\java.exe" -jar target\eduplay-admin-backend-1.5.1.jar --server.port=17070 --logging.file.name=cloud-run.log
pause
