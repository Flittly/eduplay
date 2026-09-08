# EduPlay Admin

EduPlay 管理后台前端，对接独立的云端后端工程 [eduplay-server](E:/Self/workspace/eduplay-server)。

## 运行

```powershell
npm install
npm run dev
```

开发端口：

```text
http://localhost:5174
```

Vite 会把 `/api` 代理到 eduplay-server 后端：

```text
http://localhost:18080
```

## 默认管理员

```text
用户名：admin
密码：admin123
```

管理员账号由后端启动时自动创建。

## 已接入接口

- 管理员登录 / 当前管理员 / 退出
- 数据概览
- 教师列表、搜索、禁用/启用、重置密码
- 激活码列表、批量生成、导出 CSV
