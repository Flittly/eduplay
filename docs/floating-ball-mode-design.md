# 悬浮球常驻模式设计（floating-ball-mode-design）

> 状态：**设计稿，未实现** · 目标版本 1.6.0 · 2026-10-16
> 范围：`desktop/`（Electron 壳）+ `frontend/src/pages/SettingsPage.tsx`；**不改后端、不改游戏协议**。

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 可行吗？ | **可行**。Electron 原生能力（frameless + transparent + alwaysOnTop + Tray + IPC）全覆盖，零新依赖，jlink/打包链路不用动 |
| 推荐方案 | **方案 A：双窗口**——主窗口 `hide()` 保活 + 独立轻量悬浮球窗口 + 托盘图标保底 |
| 最大的坑不是技术 | 是**关闭语义**（关窗 ≠ 退出，java.exe 还活着）与**32 位机内存驻留**（hide 不释放 WebGL） |
| 前置约束 | Electron 36+ 只支持 Win10+；机房若有 Win7 老机，无论做不做悬浮球都跑不起来 |
| 工作量 | P0（可用的 MVP）约 2~3 天；P1（托盘+单实例+语义完善）再 1~2 天 |

---

## 1. 需求与非目标

### 目标
1. 主界面可**收起为悬浮球**：小圆球常驻桌面（置顶、可拖动、不占任务栏）。
2. 点球**展开回主界面**，且展开后登录态、当前页面、（hide 模式下）游戏局内状态都还在。
3. 球模式下**后端常驻**：关掉主窗口不再连带杀掉 7070 后端。
4. 设置页新增「桌面行为」配置入口（仅桌面端显示）。
5. 与现有便携版约束共存：数据目录、稳定端口、origin 不变。

### 非目标（明确不做）
- 不做原生 overlay 进程 / C++ 挂钩 / DLL 注入（杀软必报毒，机房直接翻车）。
- 不做球上跑业务 UI（球只做"入口 + 状态指示"，业务永远在主窗口里）。
- 不改游戏包、不改 `postMessage` 协议、不动 `app_settings` 表。
- 贴边半隐藏、球上快捷动作（计时器/直达游戏）放 P2+，不阻塞 MVP。

---

## 2. 方案选型

| | 方案 A：双窗口（主窗 hide + 球窗口） | 方案 B：单窗口变形（主窗自身缩成球） | 方案 C：仅系统托盘 | 方案 D：独立原生进程 overlay |
|---|---|---|---|---|
| 形态 | 主窗 `hide()`，另开 56×56 透明置顶小窗 | 同一个 BrowserWindow `setBounds` 缩到 56×56 | 只有托盘图标，无桌面球 | 外部进程画球，IPC 联动 |
| 状态保留 | ✅ 完整（页面不销毁） | ⚠️ 需应用内做"球形态 UI"，iframe 剧烈 resize 会重排/重挂载 | ✅ 完整 | ✅ |
| 实现复杂度 | 低（~200 行主进程 + 1 个 ball.html） | 高（两套形态 UI、拖拽圆角全在 React 层） | 最低 | 很高（跨进程、双架构打包、杀软误报） |
| 内存 | 中：球 renderer +20~40MB；主窗 hide 不释放 | 低（单窗口） | 最低 | 高 |
| 用户感知 | ⭐ 最符合"悬浮球"预期 | 视觉切换生硬 | 不满足需求 | — |
| 结论 | **✅ 推荐** | ❌ 否决（复杂度不值） | 作补充保底，并入 A | ❌ 否决 |

**选 A 的核心理由**：`hide()` 不销毁 DOM ⇒ 展开即时恢复、游戏 iframe 不重挂载（现有 `GamePage` 的 `reloadNonce`/iframe `key` 机制不用碰）；而球页面用一个几十行的静态 `ball.html`，自身开销可忽略。方案 B 想省内存却把复杂度推到 UI 层，还会踩 iframe resize 坑，得不偿失。

---

## 3. 系统架构

### 3.1 进程与窗口拓扑

```
┌─ Electron 主进程 (main.js) ──────────────────────────────────┐
│  WindowManager                                                │
│   ├─ mainWindow : BrowserWindow  (1280×820, 普通框)           │
│   │    └─ React 老师端 ←─ http://127.0.0.1:{port}/            │
│   └─ ballWindow : BrowserWindow  (56×56, frame:false,        │
│        transparent, alwaysOnTop:'screen-saver', skipTaskbar)  │
│        └─ ball.html（静态页，无 React）                        │
│  DesktopSettingsStore  → {userData}/desktop-settings.json     │
│  BackendSupervisor     → spawn java -jar (现状不动)           │
│  TrayManager (P1)      → build/icon.ico 托盘 + 右键菜单        │
│  ipcMain: ball:expand / ball:collapse / ball:quit /           │
│           desktop:get-settings / desktop:set-settings         │
└───────────────┬──────────────────────────┬───────────────────┘
                │ contextBridge (preload.js)│
        ┌───────▼────────┐        ┌────────▼────────┐
        │ mainWindow 渲染 │        │ ballWindow 渲染 │
        │ SettingsPage   │        │ 球 UI + 拖动    │
        └────────────────┘        └─────────────────┘
                │ HTTP
        ┌───────▼────────────────────────────┐
        │ Spring Boot 后端 :7070 (java 进程)  │  ← 球模式下保持运行
        └────────────────────────────────────┘
```

### 3.2 文件清单

**新增（desktop/）**

| 文件 | 职责 | 规模估计 |
|---|---|---|
| `desktop/ball.html` | 悬浮球 UI：圆球、logo、状态点、拖动手势 | ~120 行 |
| `desktop/lib/window-manager.js`（或直接进 main.js） | 球/主窗生命周期、展开收起、位置记忆 | ~200 行 |
| `desktop/lib/desktop-settings.js` | `desktop-settings.json` 读写（参照 `port.txt` 的读写风格） | ~60 行 |

> 若不想拆文件，P0 全部塞进 `main.js` 也可接受（现在 876 行，加完约 1100 行）；P1 起建议拆。

**修改**

| 文件 | 改动点 | 现状锚点 |
|---|---|---|
| `desktop/main.js` | ① `createWindow()` 读设置决定 `show` 时机；② 新增 `createBallWindow()`；③ `mainWindow.on("close")` 收起拦截；④ `window-all-closed` 改为"球存在不退出"；⑤ 加 `app.requestSingleInstanceLock()` | L786 `createWindow`、L826 `closed`→`stopBackend`、L869 `window-all-closed` |
| `desktop/preload.js` | 暴露 `eduplayDesktop` 扩展 API（现在只有 `version/platform`，L3-6） | 6 行小文件 |
| `frontend/src/pages/SettingsPage.tsx` | 新增「桌面行为」section（检测 `window.eduplayDesktop`） | 现有 section 结构 L124-213 |
| `frontend/src/i18n.tsx` | 新增文案 key | — |
| `desktop/package.json` | `build.extraResources` 视需要带 `ball.html`；无需新依赖 | — |

**不动**：`backend/`、游戏包、`rename-portable.js`、`electron-builder-32.yml`（球是纯前端壳能力，x64/x86 两链路天然同享）。

### 3.3 数据流

```
设置页切换「悬浮球模式」
  → preload.desktopAPI.setSetting({ballMode:true})
  → ipcMain → 写 desktop-settings.json
  → 立即生效（无需重启：当前会话就按新语义拦截 close）

用户点主窗 ✕
  → close 事件 preventDefault → mainWindow.hide() → ballWindow.show()
  → 后端不动（7070 继续服务）

用户点球
  → ball.html mouseup（位移<5px 判定为点击）
  → ipcRenderer 'ball:expand'
  → mainWindow.show()+restore()+focus()，ballWindow.hide()
```

---

## 4. 交互状态机

```
          启动(读设置)
              │
     ┌────────┴────────┐
     │ startMinimized   │ 默认
     ▼                  ▼
  ┌──────┐  点球/托盘「打开」  ┌──────────┐
  │ COLLAPSED │ ◄───────────── │ EXPANDED │
  │  (球)     │ ─────────────► │  (主窗)  │
  └──────┘  点主窗✕ /「收起」   └──────────┘
     │         （close 拦截、hide）      │
     │ 球右键「完全退出」                │ 同左
     ▼                                  ▼
  ┌──────────────────────────────────────┐
  │ EXITING：stopBackend() → app.quit()  │
  └──────────────────────────────────────┘
```

| 当前态 | 事件 | 动作 | 新态 |
|---|---|---|---|
| EXPANDED | 点 ✕（ballMode=true） | `preventDefault` + 主窗 `hide()` + 球 `show()` | COLLAPSED |
| EXPANDED | 点 ✕（ballMode=false） | 现状不变：关窗→`stopBackend`→退出 | EXITING |
| EXPANDED | 标题栏「收起」按钮 | 同 ✕ 拦截路径 | COLLAPSED |
| COLLAPSED | 点球 / 托盘「打开」 | 主窗 `show()+focus()`，球 `hide()` | EXPANDED |
| COLLAPSED | 拖球 | 更新 bounds + 节流写位置文件 | COLLAPSED |
| COLLAPSED | 球右键「完全退出」/ 托盘「退出」 | `stopBackend()` → `app.quit()` | EXITING |
| 任意 | 后端意外退出 | 球变红色状态点 + 弹通知（**不再**直接 `app.quit()`，见 §8-6） | 原态 |

**"完全退出"入口必须显眼**：球右键菜单 + 托盘菜单 + 设置页说明三处都要有。这是关窗语义变化后最容易被用户/机房管理员投诉的点（"我明明关了，任务管理器里还有 java.exe"）。

---

## 5. 关键实现细节

### 5.1 悬浮球窗口

```js
ballWindow = new BrowserWindow({
  width: 56, height: 56,
  frame: false,
  transparent: true,          // 透明才能露出圆形
  resizable: false,
  movable: true,
  skipTaskbar: true,          // 不占任务栏
  alwaysOnTop: true,
  hasShadow: false,
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: true,  // 球自身无需高刷
    preload: path.join(__dirname, "preload.js")
  }
});
ballWindow.setAlwaysOnTop(true, "screen-saver"); // 盖过全屏 PPT/视频
ballWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true }); // 非 Win 可选项
await ballWindow.loadFile(path.join(__dirname, "ball.html"));
ballWindow.setMovable(true);
```

透明球 CSS 要点：`html,body{background:transparent}`、球体 `border-radius:50%`、**开启 GPU 加速**（默认即是）。降级策略见 §8-1。

### 5.2 点击 vs 拖动（关键交互，别用 `-webkit-app-region: drag`）

`-webkit-app-region: drag` 会**吞掉 click**，球上"单击展开"就没了。正确做法是手写：

```js
// ball.html 内
let down = null;
ballEl.addEventListener("mousedown", e => { down = { x: e.screenX, y: e.screenY }; });
ballEl.addEventListener("mousemove", e => {
  if (!down) return;
  // 通过 IPC 让主进程 setBounds（渲染层拿不到绝对坐标移动能力）
  window.eduplayDesktop.ballDragTo(e.screenX, e.screenY);
});
ballEl.addEventListener("mouseup", e => {
  if (down && Math.hypot(e.screenX - down.x, e.screenY - down.y) < 5) {
    window.eduplayDesktop.ballExpand();   // 判定为点击
  }
  down = null;
});
ballEl.addEventListener("contextmenu", () => window.eduplayDesktop.ballMenu());
```

主进程 `ballDragTo` 用 `ballWindow.setPosition(x - 28, y - 28)`（球心对齐光标），拖动结束写位置文件。

### 5.3 位置记忆与多屏 clamp

- 存 `{userData}/desktop-settings.json` 的 `ballPosition: {x, y}`（与 `port.txt` 同目录，便携版跟着数据目录走）。
- 每次 `show()` 前 clamp：`screen.getDisplayMatching(bounds)` 判定目标显示器；若该点不在任何 `display.workArea` 内（拔了副屏/改了分辨率），则吸附回主屏右下角 `workArea - 80`。**不 clamp 的话，球会飞到屏幕外变成"软件消失了"**，这是同类产品的经典翻车点。

### 5.4 主窗恢复策略：hide 保活 vs 销毁重建（核心取舍）

| | **S1：hide 保活（默认）** | S2：destroy + 重建（可选"省内存模式"） |
|---|---|---|
| 恢复速度 | 即时（<100ms） | 1~3s（重载页面） |
| 登录态/页面 | 全保留 | 登录在 localStorage 不丢，回当前路由（后端已有前端路由兜底） |
| 游戏局内状态 | **保留**（iframe 不销毁） | **丢失**（需重新开局） |
| 内存 | renderer 全额驻留（含 WebGL 上下文） | 只剩球 + 主进程 + JRE |
| CPU | Chromium 对**不可见窗口自动节流**：rAF 暂停、timer 降到 1s/次，实际占用趋近 0 | 0 |
| 结论 | **默认**——课堂场景"讲到一半收起再展开"必须无感 | 作设置项 `ballLowMemory`，32 位/低配机可开 |

实现 S1 时注意：`mainWindow.on("close")` 里 `event.preventDefault(); mainWindow.hide();`，**不要**在 hide 路径调 `stopBackend()`（现在 L826-829 的 `closed` 回调只在真正销毁时触发，`hide()` 不触发 `closed`，所以后端天然安全——但要把 `window-all-closed` 语义改掉，否则球被单独关闭时会误退出）。

### 5.5 后端生命周期语义变更

```js
// 旧：任何窗口关完就杀后端退出
app.on("window-all-closed", () => { stopBackend(); app.quit(); });

// 新：只有显式退出才杀后端
app.on("window-all-closed", () => {
  if (!ballWindow || ballWindow.isDestroyed()) app.quit();
});
app.on("before-quit", () => stopBackend());   // 已存在（L874），保留
```

⚠️ `mainWindow.on("closed")` 里现有的 `stopBackend()`（L826-829）**必须移除或加条件**，否则 S2/异常路径下主窗销毁就把后端杀了，球还亮着。

### 5.6 单实例锁（球模式的必补项）

常驻后双击两次 U 盘 exe 是高概率事件，双开=两个 java 抢端口=`resolveStablePort()` 端口漂移（**直接踩 §I 的 origin 警告**，用户看到"设置被重置"）：

```js
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on("second-instance", () => { expandFromBall(); });
```

### 5.7 preload bridge（在现有 6 行文件上扩展）

```js
contextBridge.exposeInMainWorld("eduplayDesktop", {
  version, platform,
  // 球侧
  ballExpand: () => ipcRenderer.invoke("ball:expand"),
  ballDragTo: (x, y) => ipcRenderer.invoke("ball:drag", { x, y }),
  ballMenu:   () => ipcRenderer.invoke("ball:menu"),
  // 设置侧（SettingsPage 用）
  getDesktopSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  setDesktopSetting:  (k, v) => ipcRenderer.invoke("desktop:set-setting", k, v),
  // 主窗侧
  collapseToBall: () => ipcRenderer.invoke("desktop:collapse"),
});
```

所有通道白名单校验 + `desktop:set-setting` 只接受已知 key（防任意文件写）。

---

## 6. 设置入口设计

### 6.1 UI（SettingsPage 新 section，放在「通用」之后）

仅当 `window.eduplayDesktop` 存在时渲染（网页版自动隐藏，与现有 isTeacher 的条件渲染同款做法）：

```tsx
{isDesktop && (
  <section className="settings-card">
    <h2>{t("settings.section.desktop")}</h2>
    {/* 行1：悬浮球模式总开关 —— 关闭窗口时收起到悬浮球 */}
    {/* 行2：开机自动启动（仅安装版；便携版隐藏，见下） */}
    {/* 行3：启动时直接最小化为悬浮球 */}
    {/* 行4：低内存模式（收起时释放界面，展开需重新加载） */}
    {/* 行5：（P2）全屏应用时自动隐藏悬浮球 */}
  </section>
)}
```

### 6.2 配置存储：`{userData}/desktop-settings.json`

**为什么不用现有两条通道**：

| 候选 | 为什么不合适 |
|---|---|
| localStorage（如 `eduplay.theme`） | 主进程读不到渲染层存储——`startMinimized` 在窗口创建前就要生效；且清缓存即丢 |
| 后端 `app_settings` 表 | 这是**机器/桌面壳**行为，不是平台业务；网页版也用不到；还平白多一张表的版本管理 |
| `desktop-settings.json`（新） | ✅ 主进程直接读写、与 `port.txt` 同目录同生命周期、便携版随数据目录走 |

Schema（版本化，便于以后加字段）：

```json
{
  "version": 1,
  "ballMode": true,
  "startMinimized": false,
  "ballLowMemory": false,
  "ballPosition": { "x": 1820, "y": 880 },
  "autoLaunch": false
}
```

### 6.3 开机自启的便携版陷阱

`app.setLoginItemSettings({ openAtLogin: true })` 写的是**当前 exe 的绝对路径**。便携版插在 E:、下次插成 F:，自启项就指向空气。因此：

- **安装版**：正常提供开关。
- **便携版**（`app.isPortable` / `portable-marker.txt` 存在）：隐藏该行，hint 提示"U 盘版请手动启动"。

---

## 7. 性能与资源占用

> 下表为**量级估计**，P0 验收时以实测替换（测量方法见 §10）。

| 状态 | 常驻内存（增量） | CPU | 说明 |
|---|---|---|---|
| 现状：正常展开 | 基线（Electron 主进程 + 渲染 + JRE） | 正常 | 参照系 |
| 球模式（S1 hide） | **+20~40MB**（球 renderer）；主窗渲染**不释放** | **≈0**（隐藏窗口被 Chromium 节流：rAF 停、timer 1s/次） | 这就是 S1 的全部代价 |
| 球模式 + 开着 WebGL 游戏收起 | 同上 + **WebGL 上下文驻留 100~300MB** | 渲染循环暂停（节流），但显存/内存不还 | 32 位机的真正压力点 |
| 球模式（S2 销毁重建） | **+20~40MB only** | 0 | 展开付 1~3s 重载成本 |
| 球自身动画 | +~5MB / 1~2% CPU | 悬停呼吸动画期间 | 动画只在 hover 时跑，静止时纯色 |

**32 位机专项**（`-Xmx768m` + Electron 32 位）：32 位进程虚拟地址空间上限约 2~3GB 可用，JRE 已占 768MB 堆 + Metaspace，Electron 渲染再吃 200~400MB，开 WebGL 游戏时本就紧张。⇒ **32 位包默认建议开 `ballLowMemory: true`**，或至少在设置里置灰提示。64 位包无此约束，默认 S1。

**Chromium 节流是"免费"拿到的**：`backgroundThrottling` 默认开启，`hide()` 后渲染层自动降频，不需要我们写任何省电代码。唯一要避免的是 `backgroundThrottling: false`（除非以后球上要跑计时器类动画）。

---

## 8. 技术挑战与对策

| # | 挑战 | 风险等级 | 对策 |
|---|---|---|---|
| 1 | **透明窗口黑底/失效**：部分集显、远程桌面、Win11 缩放下 `transparent:true` 渲染成黑方块 | 中 | 启动后探测：`ballWindow.getBounds()` 之外，用 `powerMonitor`/简单用户确认不可靠——务实做法：**设置里加"兼容模式（不透明圆角球）"**开关，黑底时让用户一键降级为 `backgroundColor:'#2f6fed'` 的圆角小窗；远程桌面场景文档提示 |
| 2 | **拖动 vs 单击冲突** | 中 | 手写位移判定（§5.2，阈值 5px）；不要用 `-webkit-app-region: drag` |
| 3 | **球挡住全屏 PPT/视频** | 中 | `setAlwaysOnTop(true,'screen-saver')` 是双刃剑；提供球右键「临时隐藏 30 分钟」；P2 做全屏检测自动隐藏 |
| 4 | **位置飞出屏幕**（拔副屏/改分辨率/换投影） | 高 | 每次 `show()` 前 clamp 到 `display.workArea`（§5.3），越界即回主屏右下角 |
| 5 | **关闭语义变化引发困惑/投诉**（"关了怎么还有 java.exe"） | 高 | ① 首次启用时一次性提示条；② 设置项 hint 写明；③ 托盘+球菜单「完全退出」入口显眼；④ 使用说明.txt 同步更新 |
| 6 | **后端崩溃时的连带退出**（现在 L457-466：backend exit → dialog → `app.quit()`） | 中 | 球模式下改为：球状态点变红 + 系统通知 + 弹窗只在主窗可见时弹；**不自动 quit**（否则老师看不到任何提示球就消失了） |
| 7 | **双开抢端口 → 端口漂移 → origin 换端口 → localStorage 隔离**（§I 老坑） | 高 | `requestSingleInstanceLock()` + `second-instance` 唤起已有实例（§5.6）。**球模式上线前就该修**，不分阶段 |
| 8 | **U 盘拔出**：球还亮着但 H2 在可移动盘上 | 高 | 文档强调"先完全退出再拔盘"；P2 可监听 `powerMonitor`/盘符消失事件弹警告（超 MVP，仅记录） |
| 9 | **skipTaskbar 后 Alt-Tab 找不到主窗** | 低 | 球就是入口，展开时 `showInTaskbar(true)` 恢复；收起时不给任务栏留假入口 |
| 10 | **Win11 圆角/贴靠布局干扰** | 低 | `setRoundedCorners(false)`（若可用）+ 手动圆角 CSS；球禁用 snap（frame:false 天然不受影响） |
| 11 | **杀软误报**（新增文件/行为模式变化） | 低 | 纯 Electron API、无注入无驱动，风险低；发版前老规矩真机过一遍 360/火绒 |

---

## 9. 落地路径

| 阶段 | 内容 | 交付判据 | 估计 |
|---|---|---|---|
| **P0 MVP** | 球窗口 + 点击展开/拖动 + 位置记忆/clamp + 关窗收起（ballMode 开关）+ SettingsPage 基本开关 + `desktop-settings.json` + **单实例锁** | 设置开/关球模式各走一遍；关窗后 7070 仍可访问；点球回到原页面 | 2~3 天 |
| **P1 语义完善** | 托盘图标+右键菜单、球右键菜单（展开/退出）、首次启用提示条、后端崩溃球状态变红、`closed`→`stopBackend` 条件化、使用说明.txt 更新 | 任务管理器验证"完全退出"后无 java.exe 残留；杀后端进程看球的反馈 | 1~2 天 |
| **P2 体验** | 低内存模式（S2）、开机自启（安装版）、球呼吸动画/状态点、临时隐藏、32 位默认建议值 | 32 位真机内存对比数据 | 2~3 天 |
| **P3 增值（可选）** | 全屏自动避让、贴边半隐藏、球快捷动作（计时器/最近游戏）、后端健康角标 | — | 按需 |

**回归清单（每阶段必跑）**：x64 + 32 位双包启动、便携版 U 盘数据目录完好、`resolveStablePort` 端口不漂移、游戏 iframe 展开后不重挂载、网页版（`java -jar` + 浏览器）SettingsPage 不显示该 section。

---

## 10. 评估要点（验收清单）

**功能**
1. `ballMode=true`：点 ✕ → 球出现、主窗消失、后端 7070 仍返回 200（硬证据：`curl 127.0.0.1:7070/api/v1/...`）。
2. 点球 <5px 位移 → 展开回原页面、登录态在；拖球 >5px → 只移动不展开。
3. 拔掉副屏/改分辨率后点开 → 球仍出现在可见区域。
4. 球/托盘「完全退出」→ 任务管理器中 `java.exe`/`EduPlay.exe` 均消失（硬证据，用户认可度最高的一条）。
5. 双开 exe → 第二个实例唤起第一个，不出现两个后端（查 7070 只有一份进程监听）。

**性能**（对照 §7 表格，32 位机必测）
6. 球静止 10 分钟：CPU 占用 <1%，内存不增长（任务管理器截图/`typeperf` 记录）。
7. S1 收起内存增量 ≈ 球 renderer 开销；S2 增量 <50MB。
8. WebGL 游戏收起 5 分钟后展开：S1 游戏继续、S2 正常重载可玩。

**兼容**
9. Win10 / Win11、125%/150% DPI、远程桌面下球可见（黑底则走兼容模式）。
10. x64 包与 32 位包行为一致（32 位默认 `ballLowMemory` 生效）。
11. 设置改完**不用重启**即生效（关窗语义立刻切换）。

**回退**
12. `ballMode=false` 时行为与 1.5.1 完全一致（关窗即退出、无球、无托盘残留）。

---

## 附：与现有约束的对照（确认不踩坑）

| 既有约束（MEMORY） | 本设计如何回避 |
|---|---|
| 页面 origin 必须稳定 | 单实例锁防双开端口漂移；展开用 `show()` 不换端口 |
| `frontend/dist` 须重 package jar 才生效 | 前端改动照旧走 §E 流程 |
| `AppLayout` 常驻组件只挂载一次 | S1 不重挂载，无感；S2 重载后靠 `rosterStore` 广播补数（已有机制） |
| 端到端验证别碰 7070 | 验收用临时实例（§L 流程） |
| 32 位 JVM 堆 256MB→`-Xmx768m` | §7 的 32 位内存分析已计入 |
| 便携版数据目录中文名/同级并列 | `desktop-settings.json` 落 `userData`，随数据目录走，不新增顶层目录 |
