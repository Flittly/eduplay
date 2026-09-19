# EduPlay 地理教育游戏平台（Monorepo）

本仓库包含 EduPlay 的完整工程：

- `frontend/`：老师端 React 前端
- `backend/`：老师端本地 Java 后端（H2）
- `admin-frontend/`：管理后台 React 前端
- `admin-backend/`：管理端云端 Java 后端（MySQL）
- `desktop/`：Electron 桌面壳与打包脚本
- `docs/`：设计文档

## 本地快速构建桌面版

```powershell
cd desktop
npm ci
npm run release
```

安装包输出在 `desktop/release/`。
