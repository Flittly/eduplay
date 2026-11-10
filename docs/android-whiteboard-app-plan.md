# 安卓白板版（希沃 / 一体机）实施方案

> 场景修正：教室里的设备**不是电脑**，而是希沃白板这类 Android 大屏触控一体机。
> 目标是出一个 **APK，装进去就能完整跑 EduPlay 教师端和教学游戏**，而不是做遥控器。
>
> 基线 `v1.5.2`；前端 `frontend/dist` 3.0 MB；教师侧后端 Java 约 4000 行 / 34 个端点 / 13 张表。
> 本文所有结论均标注代码位置，可复核。

---

## 0. 结论与三个关键判断

**可行，但要换掉"后端跑在哪"这个前提。** 现有架构里后端是 Spring Boot + H2，装在老师电脑上；
希沃白板没有"电脑"，所以**必须把后端搬进 APK**。这是本方案 80% 的工作量所在，也是唯一的技术难关。

### 判断一：这不是"加个客户端"，是给同一产品做第二个壳

| | PC 形态（现状） | 白板形态（新增） |
| --- | --- | --- |
| 外壳 | Electron 36 | 原生 APK（WebView） |
| 页面 | `frontend/dist` | **同一份 `frontend/dist`，0 改动** |
| 后端 | Spring Boot + H2，`127.0.0.1:7070` | **Ktor + SQLite，同样 `127.0.0.1:7070`** |
| 游戏 | 同源 iframe，后端供给 | **同样同源 iframe，同样后端供给** |

⇒ **核心设计约束只有一条：HTTP 契约一字不改。** 守住这条，前端 13 个页面、主题、i18n、游戏
`postMessage` 协议（`GAME_READY` / `GAME_INIT` / 成绩结算）全部零成本复用；守不住，就要同时改前端和两个后端。

### 判断二：不需要做响应式重排（这是最大的省钱点）

`styles.css:40` 写着 `body { min-width: 960px }` —— **现有 UI 本来就是按 ≥960px 横屏设计的**。
希沃白板是 1920×1080（部分 4K）横屏 16:9，**布局直接可用**，不存在手机上那种"13 个页面全部推倒重来"的问题。

真正要做的只有两件事：

1. **放大**：站 3 米外看 1180px 内容区太小 ⇒ 加一套 `data-form="bigscreen"` 主题，把字号/控件按 1.25–1.4 倍放大（不动布局，只动令牌）。
2. **触控化**：`SeatingPage` 用 HTML5 `drag&drop`（`SeatingPage.tsx:323-347`）⇒ **触摸屏完全不触发**，必须改 pointer events。

### 判断三：WebView 版本是头号风险，且无法靠代码绕过

希沃白板多为 Android 8.1 / 9 / 11，WebView 常停在 Chromium 70–90，且**没有 Play 商店、多数机型无法升级 WebView**。
而 `three.js` 新版与 Vite 默认产物需要较新语法（可选链、`??`、ES2020）。

⇒ **必须先做 Phase 0 真机验证再写代码**。验证不通过，整个方案要么降级 Vite target，要么自带内核（+2 周）。

---

## 1. 现场现实：设备形态决定了哪些设计

| 设备特征 | 对方案的影响 |
| --- | --- |
| 1920×1080 / 4K 横屏，65"–86" | ✅ 现有布局可用；只需放大字号，**不需重排** |
| 十点电容触摸，无鼠标键盘（部分带外接） | 🔴 **所有 hover 交互失效**（`styles.css` 有 36 处 `:hover`，均不阻塞功能但无反馈）；HTML5 拖拽失效；无右键 |
| Android 系统，SoC 多为 ARM（部分 x86） | ✅ 纯 Kotlin 方案**一个 APK 通吃**，不像 Electron 要分 32/64 位 |
| 通常联网，但教室网络不稳 | ⚠️ **离线可用是刚需** ⇒ 数据必须落本机，不能只靠云端 |
| 无鼠标 ⇒ 软键盘会遮挡输入框 | 🔴 登录、加分理由、班级名等输入需 `scrollIntoView` |
| 学校常有 MDM / 应用白名单 / 禁止未知来源 | 🔴 **APK 可能装不进去**，这是产品级风险，不是技术问题 |
| 系统无 Google 服务 | ✅ 本方案不依赖 GMS（无 FCM / 无 ML Kit） |
| 屏幕需长期常亮 | 🟡 `FLAG_KEEP_SCREEN_ON` |

---

## 2. 三条技术路线：为什么只有一条能交付

| 路线 | 怎么做 | 后端改动 | 前端改动 | 离线 | 可交付性 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A. APK 内嵌轻量后端** | Ktor + SQLite 重写 34 端点，契约不变 | 重写（Kotlin） | **0** | ✅ | ✅ 普通 APK | ✅ **推荐** |
| B. 白板仅前端，连云端 | 云端新增学生/积分/班级表 + 租户隔离 | 云端扩表（Java） | 0 | ❌ 断网即废 | ✅ | 🟡 备选 |
| C. APK 内跑原 Spring Boot jar | proot + OpenJDK 21 | 0 | 0 | ✅ | ❌ | ❌ 否决 |

### 为什么 C 被否决（重点，别再讨论第二次）

Android 没有官方 JVM，ART 跑的是 DEX。`java -jar` 需要完整 JDK；即便用 proot + Termux 塞一个
OpenJDK 21 + Linux rootfs（约 200 MB），仍然要：

- 关掉 Android 12+ 的 **phantom process killer**（需 adb + 开发者选项，且重启可能复位）；
- 处理 Spring Boot 的 Tomcat、JMX、`javax.servlet`、大量反射在 ART 上的兼容问题；
- 让学校 IT 接受"先装 Termux、再装发行版、再开机自启脚本"。

⇒ 这套方案在开发者电脑上能跑，在**教室现场不可交付**。教学设备的安装体验必须是"点一下装完"。

### 为什么 A 而不是 B（这是本方案最重要的取舍）

| 维度 | A（本地后端） | B（云端后端） |
| --- | --- | --- |
| 断网 | ✅ 照常上课 | ❌ 整节课废掉 |
| 学生数据 | ✅ 不出设备 | ❌ 上云，涉未成年人信息合规 |
| 与现有架构一致 | ✅ 沿用"local-first"立场 | ❌ 推翻 `docs/offline-cloud-architecture.md` 的核心决策 |
| 长期维护 | ❌ 两套后端要同步 | ✅ 一套后端 |
| 工作量 | 9–11 人周 | 6–7 人周 |

**选 A。** 理由：教室断网是常态而不是异常，`EduPlay` 从第一天就是 local-first（`docs/offline-cloud-architecture.md`
明确写"云端只保存账号、游戏、激活码与权益，**不保存学生数据**"）。为省 3 周去推翻这条边界，代价是
产品在最关键的场景里不可用 + 引入未成年人信息上云的合规负担。

**但 A 的长期税必须现在就设计好对策**：两套后端 = 漂移风险。对策见 §7.4 契约测试。

---

## 3. 目标架构

```text
┌─────────────────────────── APK（一个包，ARM/x86 通吃）───────────────────────────┐
│                                                                                │
│  WebView (系统 Chromium)  ← 加载 http://127.0.0.1:7070/                        │
│    ├─ React 教师端（assets 里的 frontend/dist，0 改动）                          │
│    └─ 游戏 iframe（同源！平台仍可直接读 document 注入样式）                      │
│                          ↓ HTTP（同源，无 CORS 问题）                            │
│  Ktor 内嵌服务（127.0.0.1:7070，前台 Service 常驻）                              │
│    ├─ /api/v1/**        34 个端点，契约与原 Spring Boot 完全一致                 │
│    ├─ /api/v1/plugin/** 从 filesDir/plugins/installed 逐文件供给                │
│    ├─ /cloud-api/**     转发到云端（替代原 CloudApiProxyController）             │
│    └─ /**               SPA fallback → index.html（BrowserRouter 需要）         │
│                          ↓                                                      │
│  SQLite（13 张表，与 Flyway 迁移等价）                                           │
│  filesDir/plugins/{packages,installed}/{gameCode}/{version}/...                 │
└────────────────────────────────────────────────────────────────────────────────┘
                                     ↓ 仅账号 / 商城 / 激活码
                              云端 admin-backend（不变）
```

四个要点：

1. **端口必须固定 7070**。项目已有铁律（见 `MEMORY.md` §I）：`localStorage / IndexedDB 按 origin 隔离`，
   端口一变老师就以为"设置被重置、登录丢了"。
   ⚠️ 但白板上 7070 可能已被别的应用占用 ⇒ **首次启动探测出一个可用端口后写进 SharedPreferences 永久沿用**，
   而不是每次随机。这是"固定"与"可用"的唯一兼容解。
2. **必须同源**。平台会直接操作游戏 iframe 的 document（`GamePage.tsx:83` 注释原文"平台与游戏包同源"），
   跨源立刻失效。所以游戏内容必须由同一个 Ktor 服务供给，不能在 `file://` 或另一个端口上。
3. **`BrowserRouter` 需要 SPA fallback**（`main.tsx:3`）。Ktor 要把非 `/api`、非静态文件的 404 全部返回
   `index.html`，否则老师刷新页面就白屏。
4. **游戏包按需下载、不解进 APK**。13 个游戏全塞进去会让 APK 变几十 MB 且无法热更新；走原有的
   `/store/games/{code}/package` 下载 → 校验 sha256 → 解压到版本目录。

---

## 4. 功能范围

### 4.1 P1（首个可交付版本，必须齐）

| 模块 | 内容 | 说明 |
| --- | --- | --- |
| 启动与登录 | 本地注册/登录、`/auth/me`、token 持久化 | 单机单教师账号，语义与 PC 版一致 |
| 班级 | 班级列表、班主任设置、删除 | `ClassManagementController` 3 端点 |
| 名单 | 列表/筛选/新增/编辑/删除、按班筛选 | `StudentController` 核心 6 端点 |
| 积分 | 加减分（流水）、学生积分详情 | `student_points_ledger` 天然可合并 |
| 商店 | 商品列表、安装、卸载、已安装列表、激活码兑换 | 需要联网到云端 |
| 游戏 | 插件包下载→解压→加载→`GAME_INIT`→成绩结算 | 核心体验 |
| 大屏 | 放大主题、全屏、屏幕常亮、隐藏系统栏 | 白板专属 |

### 4.2 P2（首版后补齐）

- 名单 Excel 导入/导出（**POI 在 Android 上的可用性有风险**，见 §9-R5）
- 设置页（插件目录、云端地址）、`/cloud-api` 代理
- 数据备份：导出/导入整包 zip（防卸载丢数据）
- 应用内自更新

### 4.3 明确不做

- ❌ 管理后台（`admin/*` 16 个端点）——白板不需要，也不该有
- ❌ 悬浮球常驻模式（`desktop/main.js` 的 `ball.html` 那套）——Android 侧用不到，且会引入悬浮窗权限
- ❌ 多教师/多账号切换（`local_session` 本来就是单人语义）
- ❌ 手机竖屏适配（白板是横屏，手机不是目标设备；`min-width:960px` 会横向溢出，可接受）

---

## 5. 模块划分（APK 内部 7 层）

```text
app/
├─ ui/shell          Activity + WebView + 沉浸式全屏 + 屏幕常亮 + 返回键路由后退
├─ ui/webchrome      WebChromeClient：onJsConfirm / onJsAlert / onShowFileChooser / console 转 logcat
├─ server/http       Ktor(CIO) 引擎、端口固化、SPA fallback、静态资源与缓存头
├─ server/api        auth / students / classes / store / plugin / score / settings 七组路由
├─ server/domain     业务逻辑（直译 Java 版 Service，去掉 Spring 注解）
├─ server/store      SQLite（Room 或 SQLDelight）、13 张表、迁移脚本
└─ plugins           zip 下载、sha256 校验、解压、版本目录、安全路径解析
```

### 5.1 后端重写范围（不是 34 个全写）

| 组 | 端点数 | P1 是否必需 | 备注 |
| --- | --- | --- | --- |
| `auth` | 5 | ✅ | register / login / me / logout / profile |
| `students` | 10 | ✅（6 个） | 导入/导出/模板 3 个挪到 P2 |
| `classes` | 3 | ✅ | — |
| `store` | 10 | ✅（8 个） | `package-install`/`import-package`（手动传 zip）可后置 |
| `plugin` | 1 | ✅ | 静态文件供给，含路径穿越防护（已有 `normalizeRelativePath`，照抄） |
| `score` | 1 | ✅ | — |
| `settings` | 3 | 🟡 P2 | — |
| `health` | 1 | ✅ | 探活，给 WebView 启动等待用 |
| `admin` | 16 | ❌ | 不做 |

⇒ **P1 约 21 个端点**。原 Java 侧 `StudentService` 689 行 + `GameStoreService` 707 行是大头，
其余都是薄 CRUD；去掉 Spring/Lombok 样板后 Kotlin 约 2500–3000 行可覆盖。

### 5.2 数据层

- 13 张表照搬 Flyway `V1`–`V14` 的**最终形态**（`points_account` 与 `game_session` 已被 V6/V7 删除，别再建）。
- SQLite 与 H2 的差异点：`AUTO_INCREMENT` → `INTEGER PRIMARY KEY AUTOINCREMENT`、`timestamp` → `TEXT(ISO-8601)` 或 `INTEGER(epoch)`、`boolean` → `INTEGER`。
- **不要用 Room 的注解实体直接反推表**，而是先写 DDL、再由 SQLDelight 生成访问层 —— 这样将来和 Flyway 对表更容易。

---

## 6. 与现有资产的对接

### 6.1 前端：0 改动（这是本方案的核心收益）

`frontend/dist`（3.0 MB）原样放进 `assets/web`，WebView 加载 `http://127.0.0.1:7070/`。
因为契约不变，以下全部**不用动**：

- `api.ts` 566 行（`BASE_URL = "/api/v1"` 直接命中本地 Ktor）
- `types.ts` / `i18n.tsx` / `theme.ts` / `rosterStore.ts`
- `GamePage.tsx` 的同源 iframe + `postMessage` 协议 + 样式注入
- 4 处 `window.confirm` 的实现逻辑（但**必须在 WebView 侧补 `onJsConfirm`**，见 §7.1）

### 6.2 唯一需要改的前端代码（5 项，都很小）

| # | 位置 | 问题 | 改法 |
| --- | --- | --- | --- |
| 1 | `SeatingPage.tsx:323-347` | HTML5 `drag&drop` 在触摸屏不触发 | 改 `pointerdown/pointermove/pointerup` + `setPointerCapture`（可参照 `FloatingPick.tsx:349,388` 的成熟写法） |
| 2 | 全局 | 站 3 米外字号偏小 | 加 `[data-form="bigscreen"]` 令牌，字号/按钮放大 1.25–1.4×，不改布局 |
| 3 | 输入框 | 软键盘遮挡 | 聚焦时 `scrollIntoView({block:"center"})` |
| 4 | 全局 | 无 hover 反馈 | 36 处 `:hover` 不阻塞功能，但按钮加 `:active` 态让触摸有反馈 |
| 5 | `AppLayout` | 返回键行为 | 交给壳处理：`Back` → `webView.canGoBack()` 路由后退，栈底才退出 App |

### 6.3 需要在新后端实现的"平台能力"

| 能力 | 原实现 | 新实现 |
| --- | --- | --- |
| 云端代理 | `CloudApiProxyController`（`@Profile("local")` + `HttpURLConnection`） | Ktor 转发（OkHttp），路径仍为 `/cloud-api/api/v1/**` |
| 插件文件供给 | `PluginContentController` + `PluginContentService` | 同路径；**保留 `normalizeRelativePath` 的路径穿越防护** |
| 静态资源缓存 | `StaticResourceCacheConfig`（`index.html` no-cache，`/assets/**` immutable） | 同策略 —— 否则升级 APK 后 WebView 仍用旧缓存 |
| 静态资源 | Spring 的 `classpath:/static` | assets，带正确 `Content-Type`（**`.js` 必须是 `text/javascript`，不能是 `application/javascript`**，Chromium 的动态 import 会拒) |

---

## 7. 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | Kotlin | 与 Java 后端同 JVM 生态，逻辑可直译；无 native 依赖 ⇒ 一个 APK 通 ARM/x86 |
| 内嵌服务 | **Ktor + CIO 引擎** | 体积极小（~2 MB），纯 Kotlin，无 Tomcat/Servlet 包袱 |
| 数据层 | SQLite + SQLDelight | 编译期校验 SQL；DDL 显式可控，便于与 Flyway 对齐 |
| UI 壳 | 单 Activity + WebView | 复用 3 MB 前端，不走 Compose 重写 13 个页面 |
| 最低版本 | **minSdk 24（Android 7.0）** | 覆盖学校存量设备；Android 8.1 是希沃常见版本 |
| 目标版本 | targetSdk 34 | 各商店要求 |
| JSON | kotlinx.serialization | 与 Ktor 原生配套 |
| 文件选择 | 系统 SAF（`ACTION_OPEN_DOCUMENT`） | `onShowFileChooser` 必需，否则**名单导入按钮点了没反应** |
| xlsx | 先验证 Apache POI；不通则退 CSV | POI 写样式可能触碰 AWT，Android 上缺类（R5） |
| 自更新 | `FileProvider` + `REQUEST_INSTALL_PACKAGES` | 学校无法用商店更新 |
| 加固 | R8 + 签名校验 | 防二次打包 |

**不选 Compose 重写 UI**：13 个页面 + 一套主题 + 游戏宿主，重写成本 ≥ 12 周，且会立刻产生"两个前端要同步"的新债。
**不选 Flutter / RN**：目标设备是横屏大屏，WebView 方案已经把前端 100% 复用，再加一层跨端框架只增加风险。

---

## 8. 实施步骤（P0–P4，含验收）

### P0 真机可行性验证（3–5 天，**先做，能杀掉一半风险**）

| 任务 | 验收标准 |
| --- | --- |
| 拿到目标白板型号，读 `navigator.userAgent` | 记录 Android 版本 + `Chrome/xx`（WebView 内核版本） |
| 同网段 PC 起后端，白板浏览器开 `http://<PC>:7070` | 13 个页面全部能用、无白屏 |
| 跑 3 个重负载游戏（`solar-system` / `mountain-zones` / `china-relief`） | 记录 FPS、是否有 WebGL 报错 |
| 触摸测试：座次拖拽 / 悬浮抽人 / 弹窗确认 | 明确"哪些交互在触摸下失效"的清单 |
| 软键盘测试：登录、加分理由 | 输入框是否被遮挡 |

**产物：《白板兼容性基线》**——直接决定 `vite build.target`、是否需要 `@vitejs/plugin-legacy`、
游戏是否需要声明 `minChromium`，以及是否需要自带内核。

> ⚠️ 如果这一步发现 WebView < Chromium 76 且无法升级，方案要立刻调整（见 R1），**不要带着这个不确定性往下写 3 周代码**。

### P1 骨架（2.5 周）

- Android 工程 + 单 Activity + WebView + 前台 Service
- Ktor 起在 127.0.0.1，**端口首次探测后固化**
- assets 供前端 + SPA fallback + 缓存头
- SQLite 建 13 表
- 打通链路：启动 → 等 `/health` → 加载页面 → 注册/登录 → 首页 → 名单列表

**验收**：白板上 APK 启动到首页 ≤ 6 秒；杀进程重启后仍保持登录；改了 `index.html` 后重启能看到新版本（缓存策略正确）。

### P2 业务闭环（3.5 周）

- 名单 CRUD + 积分流水 + 班级
- 商店：列表 / 安装 / 卸载 / 已装 / manifest / 兑换
- 插件包：下载 → sha256 校验 → 解压 → 版本目录 → 路径穿越防护
- 游戏加载 + `GAME_INIT` + 成绩结算

**验收**：白板上完整走一遍"装游戏 → 选学生 → 玩 → 结算 → 看积分"；断网后已装游戏仍可玩。

### P3 触控与大屏（1.5 周）

- 座次拖拽改 pointer events
- `confirm` 换自定义对话框（同时统一风格，比依赖 `onJsConfirm` 更稳）
- 放大主题、屏幕常亮、沉浸式全屏、返回键路由后退
- 软键盘避让

**验收**：全程只用手指完成所有 13 个页面的主要操作；无"点了没反应"的按钮。

### P4 交付（2 周）

| 任务 | 说明 |
| --- | --- |
| xlsx 导入导出 | POI 验证；失败则降级 CSV + 提示 |
| 备份/恢复 | 导出整包 zip（DB + 已装插件），防卸载丢数据 |
| 自更新 | 检查版本 → 下载 APK → 安装 Intent |
| 签名与加固 | 正式签名、R8、`minSdk` 回归 |
| 多机型回归 | 至少 2 个品牌 × 2 个 Android 版本 |
| 交付文档 | 未知来源安装指引、MDM 白名单申请、希沃商城上架材料 |
| 合规 | 软著、工信部 App 备案、教育类应用备案评估 |

---

## 9. 风险登记册（按发生可能性排序）

| # | 风险 | 可能性 | 影响 | 缓解 |
| --- | --- | --- | --- | --- |
| **R1** | **WebView 内核过旧且不可升级**（Chromium < 76，缺可选链/`??`/WebGL2） | **高** | 致命 | ①P0 实测 ②`vite build.target` 降到 `chrome70` + `plugin-legacy` ③游戏包声明 `minChromium` 并在平台侧拦截提示 ④兜底：自带内核（X5/Chromium，+2 周 +30 MB） |
| **R2** | **学校禁止安装第三方 APK**（MDM 白名单 / 应用锁 / 未知来源被关） | **高** | 产品级 | ①提前问 3 所目标学校 ②走希沃应用商城 ③提供 IT 放行文档 ④保留"U 盘拷贝 APK 手动安装"路径 |
| R3 | 固定端口 7070 被占用 | 中 | 高（origin 漂移 = 用户以为数据丢了） | 首次探测可用端口后**持久化固化**，不做每次随机 |
| R4 | Apache POI 在 Android 缺 `java.awt` 类 | 中 | 中 | 先做最小验证；不通则 CSV 降级或云端转码 |
| R5 | 两套后端长期漂移（同一接口两种行为） | **高**（长期） | 高 | **契约测试**：固定一组请求，同时打 PC 版 jar 与 APK 内 Ktor，比对响应 JSON；进 CI |
| R6 | 后台 Service 被系统回收，WebView 白屏 | 中 | 中 | 前台 Service + 通知；白板通常常前台，风险可控 |
| R7 | 低端 SoC 上 three.js 掉帧 | 中 | 中 | P0 实测；必要时给游戏加"低画质"开关或降低同时渲染数 |
| R8 | 卸载即丢数据（SQLite 在私有目录） | 中 | 高 | 备份导出 + 首次启动提示"定期备份"；引导放公共目录 |
| R9 | 触控误触 / 无 hover 反馈 | 中 | 低 | 按钮 ≥48dp、加 `:active` 态、危险操作二次确认 |
| R10 | 断网时商店不可用被投诉 | 中 | 中 | 已装游戏必须能离线玩；商店入口明确"需联网" |
| R11 | 软著 / 备案周期卡上架 | **高**（流程） | 中 | 第 1 周启动，内测先直发 APK |
| R12 | APK 体积（前端 3 MB + 插件按需） | 低 | 低 | 不预置游戏包 |

---

## 10. 资源与成本

### 10.1 人力（单人全职口径）

| 阶段 | 工期 |
| --- | --- |
| P0 真机验证 | 3–5 天 |
| P1 骨架 | 2.5 周 |
| P2 业务闭环 | 3.5 周 |
| P3 触控与大屏 | 1.5 周 |
| P4 交付 | 2 周 |
| **合计** | **10–11 周出内测版**，上架再加备案等待 3–4 周 |

若同时有 1 名后端协助直译 Java→Kotlin，P2 可压到 2 周，总工期 **8 周**。

### 10.2 设备与账号

- 目标机型至少 1 台真机（希沃具体型号，**必须先确认**）+ 1 台其他品牌安卓一体机/平板作对比
- 签名证书（正式，长期保存）
- 软著 + 工信部 App 备案 + （视进校方式）教育移动应用备案
- 若要走希沃商城：企业资质 + 商务对接

---

## 11. 排期

```text
W1        P0 真机验证 ──────────► Go / No-Go 评审
W2-W4     P1 骨架（壳 / Ktor / SQLite / 前端托管）
W5-W8     P2 业务闭环（名单 / 积分 / 商店 / 插件 / 游戏）
W9-W10    P3 触控与大屏（拖拽 / 弹窗 / 字号 / 输入法）
W11-W12   P4 交付（导入导出 / 备份 / 自更新 / 签名 / 回归）
W13+      3 所学校试用 2 周 → 修 bug → 上架
```

**并行项**：W1 就要启动软著与备案，不要等代码写完。

### 版本节奏

| 版本 | 节点 | 内容 |
| --- | --- | --- |
| v0.1 | W1 | 兼容性基线报告（无 App） |
| v0.2 | W4 | 能装、能登、能看名单（内部） |
| v0.3 | W8 | 能装游戏、能玩、能结算（内测） |
| v0.9 | W10 | 全触控可操作（3 所学校试用） |
| v1.0 | W12+ | 正式上架 |

---

## 12. 需要你先确认的 3 件事

这三点会直接改变方案，越早知道越好：

1. **目标白板的型号与 Android 版本**（希沃哪一款？F 系列 / V 系列 / 还是别的品牌一体机）。
   → 决定 R1 的严重程度。如果手边有一台，跑一次 `chrome://version` 就能定。
2. **是否必须离线可用**。如果是（我按"是"设计的），就必须走路线 A，10 周；
   如果学校保证有网、且愿意接受"断网就不能上课"，可走路线 B，6–7 周。
3. **老师是否既用电脑又用白板**（同一批数据要在两个设备上）。如果要，需要额外的数据互通方案
   （整包导入导出，或等 `docs/online-offline-sync-design.md` 的同步层落地）——这不在 10 周范围内。

---

## 13. 一句话总结

**这不是"给平台加个安卓客户端"，是"给同一款产品做第二个壳"。**

前端 3 MB 已经是纯静态、零后端耦合（`BASE_URL = "/api/v1"`），可以**一字不改**塞进 APK；
唯一的硬骨头是把 Spring Boot + H2 换成 Ktor + SQLite（21 个端点 / 13 张表，约 3000 行 Kotlin）。
换来的是：**教室断网照常上课、学生数据不出设备、一个 APK 通吃 ARM/x86、与 PC 版共享同一份前端。**

代价是长期维护两套后端——所以契约测试必须从第一天就进 CI，这是这笔交易的保险费。
