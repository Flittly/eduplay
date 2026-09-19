# EduPlay Admin Backend

EduPlay 管理端后端（云端），部署在服务器上，只连接 MySQL。

职责：

- 管理员登录 / 教师账号管理
- 游戏商品创建、插件包上传、上架/下架
- 激活码批量生成与导出
- 教师云端账号注册 / 登录
- 云端游戏商城：游戏列表、激活码兑换、插件包下载

不保存学生名单与学生积分。

> **关于名字**：模块名 `admin-backend` 是从"管理端"这个部署域取的，但它并非只服务管理后台——
> 老师端 App 调用的云端商城、激活码兑换与插件包下载接口（`/store/*`）也在这里。
> 之所以不叫 `cloud-backend`，是为了与 `frontend` / `backend` 这对命名保持同一维度。

## 数据库

默认数据库：`eduplay_cloud`

建表脚本：`src/main/resources/db/cloud/`

启动：

```powershell
$env:MYSQL_URL="jdbc:mysql://localhost:3306/eduplay_cloud?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="你的密码"
mvn spring-boot:run
```

默认端口：`17070`，可通过 `SERVER_PORT` 环境变量覆盖。

首次启动会自动创建管理员：

```text
用户名：admin
密码：admin123
```

管理后台前端 `eduplay-admin-frontend` 的 Vite 代理已经指向 `http://localhost:17070`，直接运行即可对接。
