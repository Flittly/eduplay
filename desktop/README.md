# EduPlay Desktop

EduPlay 老师端桌面窗口壳（Electron）。

它负责：

- 启动内嵌的 Spring Boot 本地后端（H2 + 游戏插件）
- 自动寻找空闲端口
- 打开原生窗口加载老师前端
- 把数据保存在用户目录：`%APPDATA%/EduPlay/data`

## 开发运行

先确保后端 jar 存在：

```powershell
cd E:\Self\workspace\eduplay\backend
npm --prefix E:\Self\workspace\eduplay\frontend run build
mvn -DskipTests package
```

再启动桌面壳：

```powershell
cd E:\Self\workspace\eduplay-desktop
npm install
$env:EDUPLAY_CLOUD_URL="http://localhost:18080"
npm start
```

## 打包安装包

electron-builder 会把后端 jar 复制为 `resources/app.jar`。
还需要把 JRE 放进 `resources/jre`，才能让没有装 Java 的电脑运行。

```powershell
npm run dist
```

安装包输出在 `release/`。
