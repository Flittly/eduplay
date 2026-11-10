# EduPlay 安卓客户端：可行性评估与实施方案

> ⚠️ **本文已被 `android-whiteboard-app-plan.md` 取代，保留作参考。**
> 本文的前提是"手机当教师遥控器"；实际需求是"教室设备为希沃白板（Android 大屏），需要完整 APK"。
> 两者的结论不同：白板是大屏横屏，不需要响应式重排；但必须把后端搬进 APK。
> 本文中关于接口、鉴权、游戏分发、数据边界的事实核查仍然有效，可直接引用。

> 评估基线：`v1.5.2`（`desktop/package.json`），本地后端 Spring Boot 4.1.1 + JDK 21，前端 React 18 + Vite，
> 桌面壳 Electron 36。本文所有"现状"结论均标注了代码位置，可直接复核。

---

## 0. 结论摘要

**技术上可行，但"安卓客户端"不是一个东西，是三种产品。** 三者的成本差 5 倍以上，必须先把形态定死。

| 形态 | 一句话 | 后端新增 | 客户端工作量 | 结论 |
| --- | --- | --- | --- | --- |
| **A. 教师手机遥控器** | 手机连教师 PC，遥控点名/抽人/加分/大屏 | 小（配对 + 发现 + SSE） | 5–7 人周 | ✅ **建议先做，2 个月内可上线** |
| **B. 教师全功能 App** | 把现有 13 个页面搬到手机，游戏在 WebView 里跑 | 中（响应式重做 + 局域网 HTTPS） | 14–18 人周 | 🟡 分阶段，只搬 4 个工具页 |
| **C. 学生端 App** | 学生自己登录、自己玩、积分归自己 | 大（学生鉴权 + 云端同步 + 多人房间） | 35–50 人周 | ❌ 当前不建议，是新产品不是客户端 |

**三个决定性的现状事实（也是本方案的地基）：**

1. **数据只在教师 PC 上**。学生、班级、积分、已装游戏全在本地 H2；云端 MySQL 只有账号与商城 8 张表
   （`admin-backend/src/main/resources/db/cloud/V1__init.sql`，无 student / points 表）。
   ⇒ 手机要么**在同一局域网连教师 PC**，要么等同步层落地后走云端。**没有第三条路。**
2. **只有教师账号**。`AuthService.normalizeRole()` 对非 `TEACHER` 直接抛
   `INVALID_ROLE("当前平台只允许注册教师账号")`（`AuthService.java:236-245`），`Student` 是教师名下的名单记录、
   无密码无登录（`student/Student.java`）。⇒ **学生端等于从零建一套身份体系**，不是"适配一下"。
3. **现有前端零响应式**。`frontend/src/styles.css` 全文只有 1 个媒体查询，还是 `prefers-reduced-motion`
   （第 1914 行），没有任何宽度断点；布局是 `max-width:1180px` + 固定侧边栏。
   ⇒ 现有 13 个页面在 6 寸屏上**不可用**，B 方案的大头不是"打包"，是重做布局层。

**推荐路线：A（遥控器）→ 按需扩到 B 的工具子集 → C 暂缓立项。**

理由：手机在课堂里的真实高频动作是"点名、抽人、加分、控制大屏"，全是列表 + 大按钮，**不需要**搬游戏；
而游戏是按 1280×720 投影设计的，手机上根本不该玩。先做遥控器，投入最小、价值最直接，也不动现有业务代码。

---

## 1. 现状体检：架构对移动端的支持度

### 1.1 部署形态与网络可达性

| 项目 | 现状 | 对移动端的影响 |
| --- | --- | --- |
| 本地后端端口 | `server.port: 7070`（`application.yml`） | — |
| 监听地址 | **未指定 `server.address`**，桌面壳只传 `--server.port=${port}`（`desktop/main.js:497`） | ✅ **默认绑 0.0.0.0，局域网已可达**，无需改代码即可被手机访问 |
| 数据存储 | H2 文件库 `./data/eduplay`，`AUTO_SERVER=TRUE`（`application-local.yml`） | ⚠️ 禁止手机直连数据库，只走 HTTP；`AUTO_SERVER` 只是给同机多进程用的 |
| 传输层 | 纯 HTTP，无 TLS | ⚠️ Android 9+ 默认禁明文，需 `network_security_config` 放行 + 校园网中间人风险 |
| 云端后端 | `admin-backend`，端口 17070，MySQL | ✅ 原生 HTTP 客户端不受其"无 CORS"限制 |

**这是最重要的一条好消息**：手机连教师 PC 这件事，**服务端零改动就能通**，剩下的只是 Windows 防火墙放行
（`netsh advfirewall`）/ 安装版由 NSIS 加规则。

### 1.2 认证与会话

- Bearer Token，存 `local_session` 表，`UUID` 明文随机串，**过期时间写死 9999-01-01（永久有效）**
  （`AuthService.java:38-41, 219-227`）。
- `local_session` 只有 `user_id / token / expires_at / created_at`，**没有设备标识**（`auth/LocalSession.java`）。
- 插件内容把 token 拼在 **URL 路径**里：`/api/v1/plugin/{token}/{gameCode}/{version}/{path}`
  （`frontend/src/pages/GamePage.tsx:503`，`PluginContentController.java:29`）。

移动端影响：

- ✅ 接口层零改动即可复用，Bearer 头是标准做法。
- ⚠️ **永久 token + 无设备标识** = 手机若泄露 token 等于永久后门，且无法"踢掉某一台设备"。
  ⇒ 必须补 V15 迁移：`local_session` 加 `device_name / device_type / last_seen_at / revoked`，
  并提供 `GET /api/v1/auth/sessions`（列出设备）+ `DELETE /api/v1/auth/sessions/{id}`。
- ⚠️ **token 进 URL** 在 WebView 场景会落进历史记录、`Referer`、崩溃日志。手机上若还要跑游戏，
  建议改为 `/api/v1/plugin/{gameCode}/{version}/{path}?t=<短期票据>`，票据 5 分钟有效、与 session 分离。

### 1.3 游戏分发与渲染

| 事实 | 证据 | 结论 |
| --- | --- | --- |
| 游戏是**同源 iframe** 加载 | `GamePage.tsx:658-662` | 只能跑在 WebView 里 |
| 平台**直接读 iframe document、注入样式** | `GamePage.tsx:83`（注释原文："平台与游戏包同源"）、`341` | 跨域会直接挂；原生渲染**完全不可能** |
| 通信走 `postMessage`：`GAME_READY` / `GAME_INIT` | `GamePage.tsx:262-266, 375` | 协议可复用，但需要平台侧宿主存在 |
| 插件文件由后端按 token 鉴权后逐文件供给 | `PluginContentService.serveFile()` | 手机上要能拿到这些文件，必须能连到教师 PC |
| 游戏设计分辨率面向投影（1280×720+） | 各游戏自有 `max-width`，平台不强拉（见项目约束） | ❌ **手机上不承载游戏渲染**，这是设计决策不是技术缺陷 |
| 13 个游戏全 `"type":"iframe"`、`backendPlugin:null` | 项目既有实测结论（2026-10-11） | 无原生依赖，WebView 里能跑，但性能/尺寸不可接受 |

### 1.4 前端形态

| 维度 | 现状 | 移动端改造难度 |
| --- | --- | --- |
| 框架 | React 18 + TypeScript + Vite，`api.ts` 566 行集中式 API 层 | 🟢 **可直接复用**（类型 + 请求封装都是纯 TS） |
| 页面数 | 13 个（`frontend/src/pages/`），最大 `GamePage.tsx` 833 行 | 🟡 需要按场景重排，不是简单缩放 |
| 布局 | `AppLayout` + 固定侧边栏 + `max-width:1180px` | 🔴 移动端要改成底部 TabBar + 单列 |
| 响应式 | **无**（仅 1 个 `prefers-reduced-motion` 查询） | 🔴 全部页面需逐个适配 |
| 状态共享 | `rosterStore` 广播（`AppLayout` 常驻组件只挂载一次） | 🟡 移动端需同等机制，否则名单改了其他地方不刷新 |
| 主题 | `eduplay.theme` 三处共用，`src/theme.ts` 为唯一真源 | 🟢 可搬 |
| i18n | 已有 `i18n.tsx` | 🟢 可搬 |

### 1.5 数据边界与既有规划

- 本地 13 表 / 云端 8 表，教学数据只在本地。
- `docs/online-offline-sync-design.md` 已设计 **Outbox + 最终一致** 的同步方案（`/sync/push`、`/sync/pull`、
  `/sync/state`，含冲突规则与数据量估算），**但代码里没有任何同步实现**（`V1`–`V14` 无 sync 表，
  控制器清单无 `SyncController`）。
- ⇒ **同步层是手机端"脱离局域网"的唯一解锁条件**，也是学生端的前置。它目前是"有设计、无代码"状态。

### 1.6 改造难度总评

| 层 | 难度 | 说明 |
| --- | --- | --- |
| 网络可达 | ★☆☆☆☆ | 已绑 0.0.0.0，只差防火墙 |
| 接口复用 | ★☆☆☆☆ | 原生客户端无 CORS 问题，Bearer 直接可用 |
| 设备/会话管理 | ★★☆☆☆ | 加 1 张迁移 + 3 个端点 |
| 局域网发现与配对 | ★★★☆☆ | 需新增 UDP 广播 + 配对码 + 二维码 |
| 实时联动（手机↔大屏） | ★★★☆☆ | SSE 最省；**不能复用** `CloudApiProxyController`（`HttpURLConnection` 不支持 WS） |
| 现有页面响应式化 | ★★★★★ | 13 个页面重排，最大工作量 |
| 游戏移动化 | ★★★★★ | 不建议做 |
| 学生端 | ★★★★★+ | 新身份体系 + 同步 + 合规，属新项目 |

---

## 2. 功能范围（以推荐方案 A 为准）

### 2.1 MVP（P0，必须）

| 模块 | 功能 | 依赖接口 |
| --- | --- | --- |
| 连接 | ①扫码连（PC 显示二维码）②局域网自动发现 ③手输 IP:端口 兜底 ④记住上次设备 | 新增 |
| 登录 | 教师账号密码登录，token 存 EncryptedSharedPreferences | 复用 `POST /auth/local/login` |
| 点名 | 随机点名 / 按班级筛选 / 已点不重复 / 点击记"回答正确/待加强" | 复用 `GET /students` |
| 抽人 | 单人/多人抽取，结果推大屏 | 复用 `GET /students` + 新增 SSE 广播 |
| 加分 | 给 1~N 人加/减分，填理由（默认"课堂表现"），看余额变化 | 复用 `POST /students/{id}/points` |
| 大屏联动 | 手机操作 → 教师 PC 上的"大屏页"实时显示（抽到谁 / 加分动效） | 新增 SSE |

### 2.2 P1（上线后 1–2 个迭代）

- 座次表查看与拖动调座（复用 `SeatingPage` 逻辑与 `rosterStore`）
- 红包/积分抽奖（复用 `RedPacketPage`，其奖品配置因在 `localStorage`，手机上要改为服务端存）
- 班级管理只读视图 + 学生详情（积分流水）
- 我的设备：查看/踢出已登录设备
- 离线降级：断连时显示"未连接"，已缓存的名单可只读浏览

### 2.3 P2（按需）

- 推送通知（复用 `docs/wechat-notify-design.md` 的思路，但换成 App 内通知）
- 游戏入口（**只做"在 PC 上启动"的遥控，不在手机上渲染游戏**）
- 学生名单 Excel 导入（手机上体验差，建议保持 PC 端）

### 2.4 明确不做（并且要写进需求文档，防止需求蔓延）

- ❌ 手机端渲染教学游戏（投影产物，尺寸与交互都不匹配）
- ❌ 手机端管理插件包/导入 zip（错误率高、需要文件系统权限）
- ❌ 手机当数据主库（数据主权仍在教师 PC）
- ❌ iOS 同版本（可留扩展，但不在首期）
- ❌ 学生登录

---

## 3. 模块划分

### 3.1 Android 客户端（8 个模块）

```text
app/
├─ core/network         OkHttp + 拦截器（注入 Bearer、统一 ApiResponse 解包、错误码映射）
├─ core/session         Token 存储（EncryptedSharedPreferences）、自动续期、踢出处理
├─ core/discovery       UDP 广播探测 + mDNS(NsdManager) 双通道 + 手动 IP 兜底
├─ core/realtime        SSE 客户端（okhttp-sse），断线重连 + 指数退避 + 前台服务保活
├─ core/ui              Compose 主题（对齐 eduplay 现有配色/字号）、通用组件
├─ feature/pairing      二维码扫码（ML Kit 或 zxing）、配对码输入、设备命名
├─ feature/classroom    点名 / 抽人 / 加分 三个高频动作（核心页面）
└─ feature/roster       班级切换、学生列表、学生详情、积分流水
```

关键设计约束：

- **单一 NetworkClient**：所有请求走一个 OkHttp 实例，便于统一加 header、统一超时（局域网 3s 超时 +
  1 次重试，避免课堂上转圈）。
- **名单缓存用 Room**：`students` 表本地镜像 + `updatedAt` 版本号，弱网时秒开。**但写入永远打服务端**，
  不做本地先写（遥控器的职责是操作，不是记账）。
- **课堂态不走 Compose state 共享**：走 SSE 事件 + 本地 reducer，保证大屏和手机看到同一份状态。

### 3.2 本地后端新增模块（`com.eduplay.mobile`）

```text
com/eduplay/mobile/
├─ PairingController        配对码生成/校验、设备注册、二维码 payload
├─ PairingService           一次性 nonce、TTL 120s、失败 5 次锁定
├─ DiscoveryService         UDP 广播应答（bind 7071/udp，返回 host/port/校名/版本）
├─ ClassroomController      大屏指令：ROLL_CALL / PICK / ADD_POINTS / CLEAR
├─ ClassroomEventBus        SseEmitter 注册表（按 userId 分组）
└─ SessionAdminController   设备列表 / 踢出（与 §1.2 的 V15 迁移配套）
```

⚠️ **不要**把 SSE 塞进 `CloudApiProxyController`——它是 `@Profile("local")` + `HttpURLConnection`，
天然不能转发 WebSocket/SSE。SSE 直接在本地下后端用 `SseEmitter` 实现，零新依赖。

### 3.3 教师端前端新增（改动很小）

- 新增 `/mobile` 页：显示"手机连接"二维码 + 配对码 + 已连接设备列表。
- 新增 `/bigscreen` 页（或复用现有页面加一层"遥控接收"）：订阅 SSE，被动渲染抽人/加分动效。
- ⚠️ 遵循项目既有约束：`bumpRoster()` 只写在 `api.ts`，别散着加；常驻组件取数靠 `rosterStore` 广播。

### 3.4 数据库变更（1 个迁移）

```sql
-- V15__mobile_device.sql
ALTER TABLE local_session ADD COLUMN device_name VARCHAR(64);
ALTER TABLE local_session ADD COLUMN device_type VARCHAR(16);   -- DESKTOP / ANDROID
ALTER TABLE local_session ADD COLUMN last_seen_at TIMESTAMP;
ALTER TABLE local_session ADD COLUMN revoked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE pairing_nonce (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(8) NOT NULL,
    nonce VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);
```

---

## 4. 与现有后端接口的对接方式

### 4.1 直接复用（零改动）

| 方法 | 路径 | 用途 | 注意 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/local/login` | 教师登录 | 返回永久 token，手机需自行加设备名 |
| GET | `/api/v1/auth/me` | 启动时校验会话 | — |
| GET | `/api/v1/students?keyword=&className=` | 名单 | 支持筛选，适合手机 |
| GET | `/api/v1/students/classes` | 班级列表 | `listStudentClasses` |
| POST | `/api/v1/students/{id}/points` | 加分/减分 | 返回 `StudentPointsDetail`，含余额 |
| GET | `/api/v1/students/{id}/points` | 积分流水 | — |
| GET | `/api/v1/classes` | 班级概览 | — |
| GET | `/api/v1/health` | 连通性探测 | 无鉴权，适合作发现阶段探活 |
| POST | `/api/v1/games/{code}/scores` | 游戏结算 | **手机不调**，仍由 PC 结算 |

### 4.2 需要新增

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `http://<pc>:7070/api/v1/mobile/ping` | 无鉴权，返回 `{name, version, paired:bool}`，供扫码/手输后确认"连对机器了" |
| POST | `/api/v1/mobile/pair` | body `{code, deviceName, deviceType}` → 返回绑定后的 token |
| GET | `/api/v1/mobile/qr` | PC 端调用，返回 `{nonce, url: "eduplay://pair?h=192.168.1.5&p=7070&n=xxx"}`，TTL 120s |
| GET | `/api/v1/mobile/events` | **SSE**，被 PC 端前端订阅（大屏联动） |
| POST | `/api/v1/mobile/commands` | 手机发指令 `{type:"PICK", payload:{classId, count}}`，服务端校验后广播 |
| GET | `/api/v1/auth/sessions` | 设备列表 |
| DELETE | `/api/v1/auth/sessions/{id}` | 踢出设备 |

### 4.3 实时通道：为什么选 SSE 而不是 WebSocket

| 方案 | 优势 | 劣势 | 结论 |
| --- | --- | --- | --- |
| **SSE（`SseEmitter`）** | Spring 内置零依赖；浏览器原生 `EventSource`；自动重连 | 单向（服务端→客户端） | ✅ **主选**：指令走 HTTP POST，事件走 SSE，方向天然匹配 |
| WebSocket | 双向、低延迟 | 要加 `spring-boot-starter-websocket`；Android 侧要 OkHttp WS；与现有 `HttpURLConnection` 代理冲突 | 🟡 需要双向高频时才换 |
| 轮询 `/classroom/state` | 最简单 | 课堂上 1s 轮询很浪费，且动效有延迟感 | 🟡 仅作 SSE 降级兜底 |

### 4.4 局域网发现的实现细节（最容易踩坑的一环）

1. **UDP 广播**（主）：手机向 `255.255.255.255:7071` 发 `EDUPLAY_DISCOVER_V1`，后端 `DiscoveryService`
   收到即回 `{name, host, port, version}`。**不要**用 mDNS 做主通道——Windows 不自带自定义 `_eduplay._tcp`
   的广播服务，得让用户装 Bonjour，不可接受。
2. **二维码**（次，且更好用）：PC 端 `/mobile` 页生成二维码，内含 IP + 端口 + 一次性 nonce。
   手机扫码直接配对，绕开"同一个 WiFi 吗 / 网段对吗"的全部问题。**这条应作为首选交互**。
3. **手输**（兜底）：永远保留，因为有些学校 AP 开了客户端隔离（AP Isolation），UDP 广播会被吃。
   ⚠️ 这个坑必须在 UI 上直说："如果搜不到，请手动输入电脑 IP"。

---

## 5. 技术选型建议

### 5.1 客户端框架对比

| 方案 | 复用现有代码 | 局域网/后台能力 | 学习成本 | 适用 |
| --- | --- | --- | --- | --- |
| **React Native（bare，TS）** | 🟢 高：`api.ts` 566 行 + `types.ts` 可直接搬；`rosterStore` 思路可复用 | 🟡 够用：前台服务/悬浮窗要写原生模块 | 低（团队已是 React/TS） | ✅ **推荐** |
| Kotlin + Compose | 🔴 零复用，类型要重写 | 🟢 最强 | 中高（要学 Kotlin + Compose） | 需要锁屏常驻/悬浮球/极致省电时 |
| Flutter | 🔴 零复用 | 🟢 强 | 中（要学 Dart） | 不推荐，无收益 |
| **PWA / TWA 纯壳** | 🟢 最高 | 🔴 弱 | 极低 | ❌ **被硬约束卡死**，见下 |
| 纯 WebView 壳（非 TWA） | 🟢 高 | 🟡 一般 | 极低 | 🟡 只适合"先用起来"的过渡版本 |

**为什么 PWA / TWA 走不通（关键，别被"包个壳就行"骗了）：**

- TWA 要求站点部署在 **HTTPS + 域名** 上并通过 `assetlinks.json` 校验；
- PWA 的 Service Worker 也只允许 **secure context**（HTTPS 或 localhost）；
- 而教师 PC 是 `http://192.168.x.x:7070` —— 局域网 IP + 明文，**永远不可能是 secure context**。
- ⇒ 除非给教师 PC 上自签证书（Android 需装 CA 或用证书固定）或做内网域名 + DNS-01 签证书，
  否则 PWA 这一套在"直连教师 PC"场景下**根本起不来**。

**为什么 RN 而不是原生：**这个 App 本质是"列表 + 大按钮 + 一条 SSE 长连接"，没有传感器、没有重度动画；
而现有前端是 TS，`api.ts` / `types.ts` / `i18n.tsx` / 主题色可以近乎原样迁移。
用 RN 能把首版工作量压到 Kotlin 的 60% 左右。等真有"悬浮窗 + 锁屏常驻"需求时再写原生模块。

### 5.2 其他选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 最低版本 | **Android 8.0（API 26）** | 覆盖学校存量机型；WebView 可独立升级，渲染能力不成问题 |
| 目标版本 | API 34 | 各商店当前上架要求 |
| 网络库 | OkHttp 4 + `okhttp-sse` | 一个库同时解决 HTTP 与 SSE |
| 本地存储 | Room（名单镜像）+ EncryptedSharedPreferences（token） | — |
| 扫码 | ZXing（不依赖 GMS） | ⚠️ 必须避开 ML Kit：华为等无 GMS 机型会直接崩 |
| 架构 | MVVM + Kotlin Coroutines 或 RN 的 hooks + Zustand | 单一数据流，便于 SSE 驱动 |
| 推送 | **不用 FCM**（国内不可用） | 课堂上靠 SSE + 前台通知即可；长期再评估厂商推送 |
| 构建 | Gradle + GitHub Actions（或本地） | 产物 APK + AAB（AAB 只对上 Google Play 有用，国内各商店仍收 APK） |

---

## 6. 实施步骤（5 个阶段，含验收标准）

### 阶段 0：可行性打样（1 周，**必须先做，成本最低、否定价值最高**）

| 任务 | 验收标准 |
| --- | --- |
| 手机浏览器打开 `http://<教师PC>:7070` 并登录 | 能进首页 → 证明网络链路 + 接口层可通 |
| 测 Windows 防火墙默认行为 | 记录"装完 exe 后手机是否被拦"，形成放行话术 |
| 在真机（含 1 台千元机）上截 13 个页面 | 形成"哪些页面必重做"的清单，作为 P1 需求输入 |
| WebView 打开一个游戏（`solar-system`） | 记录帧率/触控可用性，**用证据否掉"手机跑游戏"** |

> 这一步的产出是**决策依据**，不是代码。如果阶段 0 发现"教师 PC 与手机不在同一网段且无法打通"，
> 整个 A 方案要改走云端中转，成本翻倍——所以先花 1 周测，别先写 6 周代码。

### 阶段 1：连接与会话（1.5 周）

- V15 迁移 + `PairingController` / `DiscoveryService` / `SessionAdminController`
- 客户端：扫码 → 配对 → 存 token → 启动校验 → 断线可诊断（显示"连不上：可能是防火墙/不同网段"）

**验收**：三台不同品牌手机，从扫码到进入首页 ≤ 10 秒；教师 PC 重启后手机自动重连。

### 阶段 2：核心三动作 + 大屏联动（2.5 周）

- 点名 / 抽人 / 加分（含撤销：加分错误要能撤回，用反向流水而不是改余额）
- SSE 事件总线 + PC 端"大屏接收"页

**验收**：手机点"抽人"，投影上 300ms 内出现结果；连续 50 次操作无掉线；加分后 PC 端名单余额同步刷新。

### 阶段 3：功能补齐与弱网（2 周）

- 座次、红包、学生详情、设备管理、Room 名单缓存
- 弱网：3s 超时、失败重试 1 次、明确的离线态 UI

**验收**：拔掉 WiFi 3 分钟再恢复，App 不崩且自动重连；无网时仍能浏览上次缓存名单。

### 阶段 4：加固与分发（2 周，与阶段 3 部分并行）

| 任务 | 说明 |
| --- | --- |
| 传输安全 | 局域网自签证书 + 证书固定（`network_security_config` 白名单），或明确"内网明文 + 配对码"的取舍并写进风险告知 |
| 混淆与防篡改 | R8 + 签名校验 |
| 合规材料 | 隐私政策、权限最小化（只申请相机 + 网络）、**工信部 App 备案** |
| 内测分发 | APK 直发 + 蒲公英/fir.im，先给 3–5 位教师试用 2 周 |
| 商店上架 | 华为/小米/OPPO/vivo/应用宝（见 §7.1 硬门槛） |

---

## 7. 资源需求

### 7.1 硬门槛（不是工作量问题，是"没有就上不了架"）

| 材料 | 周期 | 说明 |
| --- | --- | --- |
| 软件著作权登记 | 2–3 个月（可加急到 1 个月） | 国内各安卓商店上架**必备** |
| 工信部 App 备案 | 3–4 周 | 2023 年起强制，需域名 + 主体信息 |
| ICP 备案 | 已有/需确认 | 云端 `admin-backend` 域名 |
| 隐私政策 + 权限说明 | 3 天 | 教育类审查更严 |
| **教育移动应用备案** | 视是否进校而定 | 若明确面向学校课堂使用，需按教育部《教育移动互联网应用程序备案管理办法》评估 |

⚠️ **结论：如果目标是"上架商店"，请从第 1 周就启动软著 + 备案**，否则代码写完了也只能内测分发。

### 7.2 人力

| 角色 | 投入 | 说明 |
| --- | --- | --- |
| Android/RN 开发 | 1 人 × 8 周 | 主力 |
| 后端（Java） | 0.3 人 × 3 周 | 配对/发现/SSE，都是小接口 |
| 前端（React） | 0.2 人 × 2 周 | 二维码页 + 大屏接收页 + `rosterStore` 对齐 |
| 测试 | 0.5 人 × 2 周 | 多机型 + 弱网 |
| 教师试用 | 3–5 人 | 阶段 4 |

单人全职口径：**A 方案约 2 个月出内测版，3 个月可上架**（其中 1 个月在等备案）。

### 7.3 设备与环境

- 测试机：1 台千元机（如 Redmi A 系列）、1 台主流机、1 台平板（验证横屏座次表）、1 台鸿蒙设备（无 GMS 验证）
- 教师 PC：Windows 10/11 + 有线路由 + 无线 AP 同网段；准备一台能复现"AP 客户端隔离"的环境
- 账号：华为/小米/OPPO/vivo/应用宝 开发者账号（各需企业或个人认证，约 5 个工作日）

---

## 8. 风险登记册（按发生可能性排序）

| # | 风险 | 可能性 | 影响 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R1 | **校园网 AP 客户端隔离**：手机与 PC 同 WiFi 但互相 ping 不通 | **高** | 致命（A 方案直接不可用） | ①二维码配对前先 `ping` 探测并给出明确文案 ②文档要求 AP 关闭隔离 ③兜底：手机热点让 PC 连手机 |
| R2 | **Windows 防火墙拦 7070**，便携版无管理员权限无法 `netsh` | **高** | 高（用户以为"App 坏了"） | ①安装版由 NSIS 加规则 ②便携版检测失败给出"以管理员运行一次"的引导 ③App 侧错误页直说原因 |
| R3 | **明文 HTTP + 永久 token** 在校园网被嗅探 | 中 | 高（学生名单泄露） | ①配对码 + token 绑设备 ②建议上自签 TLS + pinning ③明确"仅限校园内网使用"产品边界 |
| R4 | **教师 PC 换 IP / 休眠**，手机连不上 | 高 | 中 | ①记住上次地址 + 自动重扫 ②PC 端建议配 DHCP 静态保留 ③重连给出"电脑可能已休眠" |
| R5 | **需求蔓延成 B 方案**（"顺便把商店也搬上手机"） | **高** | 高（工期翻 3 倍） | 在需求文档里写死 §2.4 的"不做清单"，变更须走评审 |
| R6 | **学生端被要求"顺便做"** | 中 | 极高（新项目） | 单独立项，前置条件 = 同步层落地 + 学生鉴权 + 教育类备案 |
| R7 | 华为/鸿蒙无 GMS 导致崩溃 | 中 | 中 | 禁用一切 GMS 依赖（ML Kit / FCM / Play Services） |
| R8 | 厂商后台保活限制导致 SSE 掉线 | 中 | 中 | 前台服务 + 通知；课堂场景屏幕常亮，可接受 |
| R9 | 软著/备案卡住上架 | **高**（流程） | 中 | 第 1 周就启动，内测期间不影响 |
| R10 | 多设备同时改同一学生积分 → 冲突 | 中 | 中 | 积分走**追加流水**而非改余额（`student_points_ledger` 已是流水模型），天然可合并 |
| R11 | H2 被手机端"顺带"直连 | 低 | 高（库损坏） | 架构上禁止；只暴露 HTTP |
| R12 | 学生个人信息（未成年人）出境/上云 | 低（A 方案） | 极高（合规） | A 方案数据不出校；任何"上云"改动须先做合规评估 |

---

## 9. 优先级排期

### 9.1 版本节奏

| 版本 | 周期 | 内容 | 里程碑 |
| --- | --- | --- | --- |
| **v0.1 打样** | W1 | 阶段 0 全部 | Go/No-Go 评审 |
| **v0.2 内测** | W2–W5 | 连接 + 点名/抽人/加分 + 大屏联动 | 3 位教师真实课堂试用 1 周 |
| **v0.3 可用** | W6–W7 | 座次/红包/详情/弱网/缓存 | 5 位教师，连续 2 周无阻断性 bug |
| **v1.0 上架** | W8–W12 | 安全加固 + 合规 + 商店 | 华为/小米首发，其余跟进 |
| v1.1 | W13+ | 设备管理、通知、统计看板 | — |
| v2.0（需立项） | — | 学生端 / 云端同步 | 前置：同步层 + 学生鉴权 + 备案 |

### 9.2 功能优先级矩阵

| 功能 | 用户价值 | 成本 | 优先级 |
| --- | --- | --- | --- |
| 扫码配对 + 记住设备 | 高（没它什么都干不了） | 低 | **P0** |
| 随机点名 | 高 | 低 | **P0** |
| 抽人 + 推大屏 | 高 | 低 | **P0** |
| 加分/减分 | 高 | 低 | **P0** |
| 断线可诊断 | 高（省下 80% 客服） | 低 | **P0** |
| 座次表 | 中 | 中 | P1 |
| 红包抽奖 | 中 | 中 | P1 |
| 学生详情/流水 | 中 | 低 | P1 |
| 设备管理 | 中 | 低 | P1 |
| 名单离线缓存 | 中 | 中 | P1 |
| 通知/推送 | 低 | 高 | P2 |
| 手机跑游戏 | ❌ 负价值 | 极高 | **不做** |
| 学生端 | 未知（未验证需求） | 极高 | **暂缓** |

### 9.3 与平台主线的协同

| 主线事项 | 与安卓的关系 |
| --- | --- |
| `docs/online-offline-sync-design.md` 的同步层 | **是"脱离局域网"和学生端的总开关**；建议排在安卓 v1.0 之后 |
| 微信课堂通知（`docs/wechat-notify-design.md`） | 与手机 App 的推送能力重叠，**先做哪个要想清楚**：微信触达更广，App 更适合交互操作 |
| 32 位 / 便携版链路 | 无交集，不影响 |
| 插件包体系 | 手机端不消费插件包，无影响 |

---

## 10. 一句话结论

**做"教师手机遥控器"，不要做"手机版 EduPlay"。**

现有架构对移动端的支持度是"接口层 90 分、布局层 0 分、身份层 0 分"：
接口靠原生 HTTP 可以直接复用，局域网也早已可达（后端默认绑 0.0.0.0）；
但 13 个页面零响应式、只有教师账号、游戏只能同源 iframe 渲染这三件事决定了——
**把整个平台搬上手机是 18 人周的活，而把课堂里最高频的 4 个动作搬上手机只要 5 人周。**
先拿这 5 人周验证教师是否真的会用手机上课，再决定要不要投剩下那 13 人周。
