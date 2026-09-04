# EduPlay 本地 / 云端架构

## 目标

- 老师电脑：本地离线优先，学生名单与积分保存在本机。
- 云端服务器：只保存账号、游戏、激活码与权益，不保存学生数据。

## 运行形态

同一个后端通过 profile 切换两种形态：

| Profile | 运行位置 | 数据库 | 职责 |
| ------- | ------- | ------ | ---- |
| `local` | 老师电脑 | H2（本地文件） | 本地账号、学生、积分、已安装游戏、插件文件 |
| `cloud` | 云端服务器 | MySQL | 云账号、游戏商品与插件包、激活码、权益 |

本地启动：

```powershell
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

云端启动：

```powershell
$env:MYSQL_URL="jdbc:mysql://服务器地址:3306/eduplay_cloud?..."
$env:MYSQL_USER="root"
$env:MYSQL_PASSWORD="..."
mvn spring-boot:run -Dspring-boot.run.profiles=cloud
```

## 当前状态

第一阶段已完成：

- 默认与 `local` profile 使用 H2，保留完整学生/积分能力；
- `cloud` profile 使用 MySQL，建表脚本位于 `db/cloud`，不含学生与积分表；
- 云端不加载学生、积分结算、本地安装、插件内容接口；
- 云端提供独立的商城接口（`/store/games`、兑换、下载插件包）；
- 管理端接口不依赖学生表。

第二阶段（老师电脑端 H2 + MySQL 双数据源）仍在设计/实施中。
