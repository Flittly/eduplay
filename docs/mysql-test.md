# MySQL 云端后端测试

## 1. 确认 MySQL 已启动

```powershell
Get-Service MySQL80
```

如果状态不是 Running：

```powershell
Start-Service MySQL80
```

## 2. 创建云端数据库

进入 MySQL：

```powershell
mysql -u root -p
```

执行：

```sql
create database eduplay_cloud
  default character set utf8mb4
  collate utf8mb4_unicode_ci;
```

## 3. 启动云端后端

云端后端是独立工程 `eduplay-server`：

```powershell
cd E:\Self\workspace\eduplay-server

$env:MYSQL_USER='root'
$env:MYSQL_PASSWORD='123456'
$env:MYSQL_URL='jdbc:mysql://localhost:3306/eduplay_cloud?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true'

mvn spring-boot:run
```

云端后端默认端口 `18080`。

## 4. 验证表结构

```powershell
mysql -u root -p eduplay_cloud
```

```sql
show tables;
```

应该只包含云端表，不包含学生/积分表：

```text
activation_code
app_user
game_package
game_product
local_session
user_entitlement
```

## 5. 老师端本地后端

老师电脑本地后端不再连接 MySQL，默认使用 H2：

```powershell
cd E:\Self\workspace\eduplay\backend
mvn spring-boot:run
```

默认端口 `8080`。学生名单、积分、本机已安装游戏都存在本机 H2。
