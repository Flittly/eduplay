# EduPlay

可插拔地理教育游戏平台。

## 当前阶段

第一阶段：可运行的纵向切片。

- 后端：Java 21 + Spring Boot 4.1.x + Spring Data JPA + H2 + Flyway
- 前端：React 19 + TypeScript + Vite 8
- 游戏：行政区拼图示例
- 能力：游客创建、游戏目录、游戏会话、积分流水

## 目录

```text
eduplay/
├── backend/   Spring Boot 后端
└── frontend/  React 前端
```

## 本地运行

后端：

```powershell
cd backend
mvn spring-boot:run
```

如果 8080 端口被占用，可以临时换端口：

```powershell
cd backend
mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=18080
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

如果后端端口不是 8080，前端启动前设置代理地址：

```powershell
cd frontend
$env:VITE_PROXY_TARGET='http://localhost:18080'
npm run dev
```
