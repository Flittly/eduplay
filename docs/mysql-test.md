# MySQL 本地测试

## 1. 确认 MySQL 已启动

本机服务名是 `MySQL80`，可以先检查：

```powershell
Get-Service MySQL80
```

如果状态不是 Running：

```powershell
Start-Service MySQL80
```

## 2. 创建数据库和测试用户

进入 MySQL：

```powershell
mysql -u root -p
```

执行：

```sql
create database eduplay
  default character set utf8mb4
  collate utf8mb4_unicode_ci;

create user 'eduplay'@'localhost' identified by 'eduplay123';
grant all privileges on eduplay.* to 'eduplay'@'localhost';
flush privileges;
```

如果不想新建用户，也可以直接用 root：

```powershell
mysql -u root -p eduplay
```

## 3. 启动后端 MySQL profile

使用新建的 eduplay 用户：

```powershell
cd E:\Self\workspace\eduplay\backend

$env:MYSQL_USER='eduplay'
$env:MYSQL_PASSWORD='eduplay123'
$env:MYSQL_URL='jdbc:mysql://localhost:3306/eduplay?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true'

mvn spring-boot:run '-Dspring-boot.run.profiles=mysql' '-Dspring-boot.run.arguments=--server.port=18080'
```

## 4. 验证数据库表已创建

启动日志中看到 Flyway 执行成功即可。

也可以重新打开 MySQL：

```powershell
mysql -u eduplay -peduplay123 eduplay
```

查看表：

```sql
show tables;
```

应该能看到：

```text
activation_code
app_user
game_package
game_product
local_session
student
student_points_ledger
user_entitlement
user_game_install
```

## 5. 本地 H2 和 MySQL 的关系

- 默认启动使用 H2：`application.yml`
- 测试 MySQL 使用 `mysql` profile：`application-mysql.yml`

两套 Flyway 脚本相互独立：

```text
H2:   classpath:db/migration
MySQL: classpath:db/mysql
```
