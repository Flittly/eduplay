# EduPlay 第一阶段：可运行纵向切片

## 阶段目标

先证明一条完整业务链路能跑通：

游客创建 -> 游戏中心 -> 打开行政区拼图 -> 完成游戏 -> 后端结算积分 -> 查看积分。

这一阶段不包含正式登录、支付、插件热加载和桌面安装包，先把底座跑起来。

## 已完成

- 后端工程：Java 21 + Spring Boot 4.1.1 + Spring MVC + Spring Data JPA + H2 + Flyway
- 数据库迁移：用户、游戏、积分账户、积分流水、游戏会话
- 游客账号接口
- 游戏目录接口
- 游戏会话开始与结束接口
- 积分发放与幂等流水
- MockMvc 接口冒烟测试
- 前端工程：React 19 + TypeScript + Vite 8
- 游戏中心、游客试玩、行政区拼图示例

## 当前接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查 |
| POST | `/api/v1/users/guest` | 创建游客 |
| GET | `/api/v1/games` | 游戏目录 |
| GET | `/api/v1/games/{gameCode}` | 游戏详情 |
| POST | `/api/v1/games/{gameCode}/sessions` | 开始游戏会话 |
| POST | `/api/v1/games/{gameCode}/sessions/{sessionNo}/complete` | 结束会话并结算积分 |
| GET | `/api/v1/users/{userId}/points` | 查询积分 |

## 本地运行

后端：

```powershell
cd backend
mvn spring-boot:run
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

## 下一阶段

- Spring Security + JWT 登录
- 本地账号与在线账号
- 游戏插件包格式
- 插件动态加载
- 授权/激活码
- Electron 安装包
