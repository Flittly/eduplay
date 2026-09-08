# EduPlay 地理教育游戏平台（Monorepo）

本仓库包含 EduPlay 的完整工程：

- `frontend/`：老师端 React 前端
- `backend/`：老师端本地 Java 后端（H2）
- `desktop/`：Electron 桌面壳与打包脚本
- `server/`：云端 Java 后端（MySQL）
- `admin/`：管理后台前端
- `docs/`：设计文档

## 本地快速构建桌面版

```powershell
cd desktop
npm ci
npm run release
```

安装包输出在 `desktop/release/`。
