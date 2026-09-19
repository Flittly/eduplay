# 公众号通知投屏 · 实施计划

> 设计依据：`docs/wechat-notify-design.md`
> 制定日期：2026-09-19
> 状态：**待审核**（用户确认后开工）

---

## 0. 先确认的六个事实（均来自现有代码，不是假设）

| # | 事实 | 对计划的影响 |
|---|---|---|
| 1 | `backend` 的 `CloudApiProxyController` 带 `@Profile("local")`，且用 `HttpURLConnection` **做 HTTP 转发** | ⚠️ **它无法转发 WebSocket**（Upgrade 需双向流）。⇒ 设计文档 §11 的"方案 B（本地 backend 持有云连接）"**不是更麻烦，而是要额外改造**；**方案 A（Electron main 直连云端 WS）成为唯一无需改本地 backend 的选择** |
| 2 | `admin-backend/pom.xml` **没有 websocket 依赖** | P1 需新增 `spring-boot-starter-websocket`。⚠️ Spring Boot 4 里这个 artifactId **未改名**（仍是 `spring-boot-starter-websocket`，它依赖 `spring-boot-starter-webmvc` + `spring-boot-websocket`），version 由 parent 管理 |
| 3 | `admin-backend` 用 **Flyway**，当前迁移到 `db/cloud/V3__seed_game_tags.sql` | 新表 = **`V4__*.sql`**。⚠️ **V1 绝不可改**（已应用的校验和） |
| 4 | **班级数据在本地**（`backend/.../student/TeacherClass.java` + `ClassManagementService`），**云端没有** | 云端根本不知道有哪些班级 ⇒ 设计文档里那个"短名从平台班级列表下拉选"的方案**技术上取不到数据**。⇒ **用户选「手填」不仅是偏好，而是唯一可行解** |
| 5 | `desktop/main.js` **目前没有任何 `ipcMain`**；`preload.js` 只暴露 `version` / `platform` | P0 要**从零建立 IPC 通道**（不是扩展，是新建） |
| 6 | `admin-backend` 包结构为 `com.eduplay.{common,health,game,auth,user,admin}` | 新增包建议 `com.eduplay.notify`，与现有按业务域分包的习惯一致 |

**端口**：本地 backend `7070`｜云端 `admin-backend` `17070`｜管理后台 dev `5174`

---

## 1. 阶段总览

| 阶段 | 目标 | 主要改动 | 能否独立验收 |
|---|---|---|---|
| **P0** | 本机投屏闭环（**完全不碰微信**） | `desktop/` + `frontend/SettingsPage` | ✅ 点按钮就验证 |
| **P1** | 微信链路联调（测试号 + 穿透） | `admin-backend/`（回调 + WS）+ `desktop/`（WS 客户端） | ✅ 手机发消息见大屏 |
| **P2** | 配对码绑定 | `admin-backend/` + `frontend/` | ✅ 发码即绑定 |
| **P3** | 多设备 + 定向 + 离线补推 | 两端 + 设置页 | ✅ 两块屏定向 |
| **P4** | 部署与合规 | 域名 / 备案 / Nginx / 公众号配置 | ✅ 真实公众号可用 |
| **P5** | 打磨 | 历史页 / 免打扰 / 批量 | — |

**P0 必须先做，不可跳过。** 理由：它把「Electron 投屏好不好用」和「微信链路通不通」两个问题**解耦**。否则调试时一出问题，你会分不清是投屏写错了还是回调没收到。

---

## 2. P0 · 本机投屏闭环

**目标**：在没有任何云端、没有任何微信的情况下，点一个按钮就能看到气泡/全屏/播报的完整效果。

### 2.1 新增 `desktop/notify-window.js`

| 函数 | 职责 |
|---|---|
| `showBubble({ title, body, duration })` | 右下角气泡 |
| `showFullscreen({ title, body })` | 全屏强投 |
| `closeAll()` | 统一关闭（Esc / 退出时清场） |

**气泡窗口的关键属性**（每一条都有具体理由）：

```js
new BrowserWindow({
  width: 380, height: 120,
  frame: false, transparent: true,
  focusable: false,        // ⚠️ 关键：不抢键盘焦点，否则打断正在讲课的演示
  alwaysOnTop: true, skipTaskbar: true, resizable: false
});
```

- 坐标用 `screen.getPrimaryDisplay().workArea`（**不是 `bounds`**），否则右下角会被任务栏盖住。
- 多个气泡**纵向堆叠**（最多 3 个），从下往上排。

**全屏窗口**：

```js
win.setAlwaysOnTop(true, "screen-saver");  // ⚠️ 默认层级压不过 PPT 放映
```

- 必须监听 `screen.on("display-removed")`：外接屏拔出后窗口会停在**不存在的坐标**上，现象是"投屏了但屏幕上什么都没有"。

**内容渲染**：一律 `textContent` / `createTextNode`，**绝不 `innerHTML`**。Electron 里的 XSS 后果比浏览器严重得多（可触及 Node 能力）。

### 2.2 播报（TTS）

**先试方案 1，不行再上方案 2**：

| 方案 | 做法 | 评价 |
|---|---|---|
| **1. Chromium 内置** | 渲染进程 `speechSynthesis.speak(new SpeechSynthesisUtterance(text))` | ✅ 零依赖、零外部进程、直接用 Windows 语音；**优先试这个** |
| 2. Windows SAPI | `execFile("powershell", ["-Command", "Add-Type -AssemblyName System.Speech; ..."])` | ⚠️ 要 spawn 外部进程，且 **必须用 `execFile` 而非 `Start-Process`**（本机环境块有仅大小写不同的重复键，`Start-Process` 会抛异常） |

⚠️ 播报在**投屏所在的那台机器**上出声，所以 TTS 的调用点应该在投屏窗口的进程侧，而不是发起通知的那一端。

### 2.3 IPC 通道（从零建）

`preload.js` 暴露：

```js
contextBridge.exposeInMainWorld("eduplayDesktop", {
  version: ...,
  platform: ...,
  notify: {
    test: (payload) => ipcRenderer.invoke("notify:test", payload),
    setCloudSession: (session) => ipcRenderer.invoke("notify:setCloudSession", session)
  }
});
```

`main.js` 注册对应 `ipcMain.handle`。⚠️ 现有 preload 只有 6 行，是新增不是修改。

### 2.4 设置页加「测试投屏」

`frontend/src/pages/SettingsPage.tsx` 增加一个调试区块：两个按钮（普通通知 / 紧急通知），点了走 IPC。

### 2.5 P0 验收标准（逐条可测）

- [ ] 点「普通通知」→ 右下角出现气泡，**当前窗口的键盘焦点不丢**（正在输入的地方不中断）
- [ ] 气泡 12s 后自动消失
- [ ] 连续点 3 次 → 三个气泡纵向堆叠，不重叠
- [ ] 点「紧急通知」→ 全屏覆盖，按 Esc 可关
- [ ] 紧急通知有语音播报，内容 = 正文
- [ ] 拔掉外接显示器 → 不报错、窗口不消失
- [ ] 在副屏上触发 → 气泡出现在**主屏**右下角（或按配置的屏）

---

## 3. P1 · 微信链路联调

**目标**：手机微信发一条消息，大屏弹出来。

### 3.1 云端（`admin-backend`）

新增包 `com.eduplay.notify`：

| 类 | 职责 |
|---|---|
| `WechatSignature` | SHA1 验签（手写，不引 WxJava） |
| `WechatMessageParser` | 明文 XML → 统一结构；提取 `MsgId` / `FromUserName` / `Content` |
| `WechatCallbackController` | `GET /api/v1/wechat/callback`（握手返回 `echostr`）<br>`POST /api/v1/wechat/callback`（**验签 → 幂等去重 → 立即 ACK → 异步投递**） |
| `NotifyCommandParser` | §5 的三段式正则解析，输出 `{priority, target, body}` |
| `NotifyMessageRepository` 等 | 四张表的 JPA 实体 + Repository |
| `TeacherWebSocketHandler` | `/api/v1/ws/teacher`，维护 `deviceId → Session` 映射 |
| `WebSocketConfig` | 注册 handler，设置 `setAllowedOrigins` |
| `NotifyDeliveryService` | 路由 → 查目标设备 → 投递 → 收 ack → 改状态 |

**`pom.xml` 新增**（Boot 4 名称未变，已核实）：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
```

### 3.2 本地（`desktop/`）

新增 `desktop/notify-client.js`：main 进程的 WS 客户端。

- 用 **Node 22 全局 `WebSocket`**（Electron ^36 = Node 22，零依赖）
- **指数退避重连**（1s → 2s → 4s → … 封顶 30s）+ 心跳 `ping/pong`
- 收到 `notify` 消息 → 调 `notify-window.js` 投屏 → 回 `ack`

**token 从哪来**：渲染进程的 `localStorage["eduplay.cloud.token"]`，通过 `notify:setCloudSession` 交给 main（main 读不到 localStorage）。cloudBaseUrl 同样由渲染进程提供（它本来就知道，来自本地 backend 的 `/cloud-api` 代理配置）。

### 3.3 联调环境

- **微信接口测试号**（`mp.weixin.qq.com/debug/cgi-bin/sandbox`，扫码即得，免认证）
- **`cpolar http 7070`** → 得到 `https://xxxx.cpolar.cn`（走 443，符合微信"只允许 80/443"的硬要求）
- 本地起 jar：`--server.port=7071`（别占 7070）

⚠️ 顺序不能反：**先让回调接口能响应，再去后台填 URL**。点「提交」的瞬间微信会立刻发 GET 校验。

### 3.4 P1 验收标准

- [ ] 微信后台配置 URL **保存成功**（说明握手验签正确）
- [ ] 手机发 `#通知 #全部 #测试内容` → 大屏气泡出现，内容逐字一致
- [ ] 手机收到被动回复（如「已收到」）
- [ ] 同一条消息连发 3 次 → 屏幕上**只弹 1 次**（`MsgId` 幂等生效）
- [ ] 配置 URL 后 **5 秒内**返回（用 curl 计时验证，不能超）
- [ ] 拔网线 → 客户端重连；恢复后能继续收

---

## 4. P2 · 配对码绑定

**目标**：把"哪个微信"和"哪个教师账号"绑起来。

| 项 | 内容 |
|---|---|
| 云端接口 | `POST /api/v1/wechat/binding/code`（生成 6 位码）<br>`GET /api/v1/wechat/binding`（查绑定状态）<br>`DELETE /api/v1/wechat/binding`（解绑） |
| 解析器扩展 | `#绑定 <code>` / `#解绑` / `#状态` / `#帮助` |
| 前端 | 设置页显示配对码 + 倒计时 + 当前绑定状态 |
| 安全 | 6 位码 5min TTL、一次性、**每码 5 次失败作废**、openid 级限流 |
| 生命周期 | 收到 `unsubscribe` 事件 → 自动解绑 |

**验收**：
- [ ] 设置页生成码 → 微信发 `#绑定 482913` → 设置页变为「已绑定」
- [ ] 同一个码用第二次 → 提示已失效
- [ ] 未绑定的 openid 发 `#通知` → 收到引导语，**不投屏**
- [ ] 微信里取消关注 → 绑定关系自动清除

---

## 5. P3 · 多设备 + 定向 + 离线补推

| 项 | 内容 |
|---|---|
| `deviceId` 生成 | main 进程首启生成 UUID，存 `userData/device.json`，**不读取任何机器指纹**（设计 §7.1/§7.5） |
| 云端接口 | `POST /api/v1/devices/register`<br>`GET/PATCH/DELETE /api/v1/devices/{deviceId}` |
| 定向路由 | 短名**精确匹配**；`全部` 为保留值；**未命中 ⇒ 报错 + 列可用短名，不投屏** |
| 短名校验 | 手填，2–4 字、不含空格与 `#`、不可占用 `全部`、**账号内允许重复** |
| 离线补推 | PENDING + 上线 flush（限 20 条）+ **24h 过期不补推** |
| 前端 | 设备管理（列表 / 改名 / 短名 / 接收开关 / 移除） |

**验收**：
- [ ] 两个不同的 `userData` 各起一次 → 云端出现两台设备
- [ ] `#通知 #3班 #…` → **只有短名为 3班 的那台弹**
- [ ] `#通知 #全部 #…` → 全部弹
- [ ] `#通知 #13班 #…` 而只有 `3班` → **回执报错，屏幕不弹**（这条是防误广播的关键）
- [ ] 关掉一台的接收开关 → 它不再收到
- [ ] 一台断网 1 小时后再连 → 补推积压消息；断网 30 小时后再连 → **不补推**（已过期）

---

## 6. P4 · 部署与合规

这一步**可以并行提前启动**（因为它有 1–4 周的行政等待期），但代码不依赖它。

1. 域名注册 + 实名（信息同步工信部约 3 天）
2. 大陆服务器（**包年包月 ≥3 个月**才能备案；按量付费不行）
3. ICP 备案（云厂商初审 → 工信部短信核验 → 管局，1–4 周）
4. **公安联网备案**（ICP 通过后 30 日内，最易漏）
5. 免费 DV 证书 + 自动续期
6. **Nginx 反代**：

```nginx
location /api/v1/wechat/ {
    proxy_pass http://127.0.0.1:17070;
}
location /api/v1/ws/teacher {
    proxy_pass http://127.0.0.1:17070;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # ⚠️ WS 必需
    proxy_set_header Connection "upgrade";       # ⚠️ WS 必需
    proxy_read_timeout 3600s;                    # ⚠️ 默认 60s 会周期性掐断长连接
}
```

7. 公众号后台填服务器配置（URL + Token + **明文模式**）

**验收**：真实公众号（非测试号）发消息 → 大屏投屏。

---

## 7. 数据表设计（P1 一次到位，V4）

⚠️ **按多设备设计**，即使 P1 只有一台设备。否则后期要迁移。

```sql
-- V4__notify.sql

-- 微信身份 ↔ 教师账号
CREATE TABLE wechat_binding (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  openid       VARCHAR(64) NOT NULL UNIQUE,
  user_id      BIGINT      NOT NULL,
  nickname     VARCHAR(64),
  created_at   DATETIME    NOT NULL,
  CONSTRAINT uk_binding_openid UNIQUE (openid)
);

-- 配对码（临时）
CREATE TABLE wechat_binding_code (
  code        VARCHAR(8) PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  expire_at   DATETIME NOT NULL,
  used        TINYINT(1) NOT NULL DEFAULT 0,
  fail_count  INT NOT NULL DEFAULT 0
);

-- 设备注册表
CREATE TABLE notify_device (
  device_id       VARCHAR(64) PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  name            VARCHAR(64),
  tag             VARCHAR(16),            -- 短名，允许重复（= 天然分组）
  platform        VARCHAR(32),
  receive_enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_at    DATETIME
);

-- 消息本体
CREATE TABLE notify_message (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  priority   VARCHAR(16) NOT NULL,        -- NORMAL | URGENT
  target     VARCHAR(32),                 -- 解析出的目标短名（全部 / 3班）
  content    TEXT,
  expire_at  DATETIME NOT NULL,           -- = created_at + 24h
  created_at DATETIME NOT NULL
);

-- 每台设备一行，独立 ack
CREATE TABLE notify_delivery (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  message_id   BIGINT NOT NULL,
  device_id    VARCHAR(64) NOT NULL,
  status       VARCHAR(16) NOT NULL,      -- PENDING | DELIVERED | EXPIRED
  delivered_at DATETIME,
  attempts     INT NOT NULL DEFAULT 0,
  CONSTRAINT uk_delivery UNIQUE (message_id, device_id)
);

-- 微信 MsgId 幂等去重
CREATE TABLE wechat_msg_id (
  msg_id     VARCHAR(64) PRIMARY KEY,
  created_at DATETIME NOT NULL
);
```

⚠️ **每台设备独立 ack，绝不合并**——合并会把「一台收到」误判成「都收到」。

---

## 8. 待你确认（开工前）

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | **阶段顺序**认可吗？P0 先做（完全不碰微信） | ✅ 强烈建议。两个问题解耦，调试成本差一个数量级 |
| 2 | **TTS 方案**：先试 Chromium 内置 `speechSynthesis`，不行再上 PowerShell SAPI？ | 建议先试内置（零依赖、无外部进程） |
| 3 | 新包名 `com.eduplay.notify` 是否符合你的习惯？ | 与现有 `game` / `student` / `settings` 按业务域分包一致 |
| 4 | **设备管理界面**放哪：塞进 `SettingsPage.tsx`，还是独立页 `NotifyPage.tsx`？ | 建议**独立页**（有列表、编辑、开关，塞设置页会撑大），侧边栏加入口 |
| 5 | **免打扰默认值**（设计文档 §16 仍未定） | 建议默认**关闭**（"没投屏"比"被投屏"更难排查） |
| 6 | `admin-frontend` 是否需要看绑定关系/投递统计？ | 建议 P4 之前不做 |

---

## 9. 明确不做（首版）

- 不做主动推送（未认证订阅号没有客服接口）
- 不做图片/语音/视频消息（回执提示"暂只支持文字"）
- 不做家长触达、群发、已读回执
- 不做"无前缀默认投屏"开关（会废掉误触发防线）
- 不引入 Redis（单校 QPS 极低，内存队列足够；等真上量再说）
- 不读取任何机器指纹（设计 §7.1/§7.5）
