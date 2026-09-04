# EduPlay 本地 / 云端架构

## 目标

- 老师电脑：本地离线优先，学生名单与积分保存在本机。
- 云端服务器：只保存账号、游戏、激活码与权益，不保存学生数据。

## 运行形态

云端后端已独立为单独的工程，不再通过 profile 混在同一份代码里。

工程结构：

| 工程 | 运行位置 | 数据库 | 职责 |
| ------- | ------- | ------ | ---- |
| `eduplay/backend` | 老师电脑 | H2（本地文件） | 本地账号、学生、积分、已安装游戏、插件文件 |
| `eduplay-server` | 云端服务器 | MySQL | 云账号、游戏商品与插件包、激活码、权益、管理接口 |

老师端本地后端启动：

```powershell
mvn spring-boot:run
```

云端后端启动（在 `eduplay-server` 目录）：

```powershell
$env:MYSQL_URL="jdbc:mysql://服务器地址:3306/eduplay_cloud?..."
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="..."
mvn spring-boot:run
```

## 当前状态

已完成：

- 老师端后端 `eduplay/backend` 只连本地 H2，保留完整学生/积分能力；
- 云端后端已拆为独立工程 `eduplay-server`，只连 MySQL，不含学生与积分表；
- `eduplay-server` 提供管理员与云端商城接口（`/store/games`、兑换、下载插件包）；
- 管理后台 `eduplay-admin` 对接 `eduplay-server`。
