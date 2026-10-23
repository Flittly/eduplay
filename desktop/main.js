const { app, BrowserWindow, dialog, Menu, session, Tray, Menu: MenuBuilder, ipcMain, screen, nativeImage } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

// ── 便携模式（U 盘运行）───────────────────────────────────────────────
// 若 exe 同目录存在 portable.txt，就把 Electron 的用户数据目录整个搬出程序目录。
//
// 数据放在**程序目录的兄弟位置**，而不是程序目录里面：
//   F:\EduPlay-便携版\              ← 程序：更新时整个替换掉
//   F:\EduPlay-用户数据（请勿删除）\  ← 数据：班级/学生/积分/登录态，永不被更新碰到
// 于是"更新版本"退化成"替换一个文件夹"，用户不可能手滑把数据连根删掉。
//
// 为什么不把数据放进程序目录（那是更直觉的"便携版"做法）：
// 更新时必须叮嘱"换成新的，但别动里面那个文件夹"——这是一条**带例外**的指令，
// 而"删掉旧文件夹再拷新的"恰恰是老师更新时的第一反应，那个动作会连数据一起删。
// 并列布局的更新指令是"整个换掉程序文件夹"，没有例外可记错。
//
// 目录名带中文和"请勿删除"：老师只会在资源管理器里看到这两个文件夹，
// 归属和"别删"必须写在名字上，不能指望他点开里面的说明文件。
// 实测非 ASCII 路径对 Electron 与 Java（cwd + H2 相对路径）均无影响。
//
// userData 是「本地数据库 + Chromium 缓存 + localStorage（登录令牌）」的根目录，
// 改这里等于把学生数据和登录状态一并放进 U 盘。
//
// 必须在模块顶层同步执行：app ready 之后 Chromium 的存储路径就已固定，
// 那时再 setPath 不会生效。
const exeDir = path.dirname(process.execPath);
const parentDir = path.dirname(exeDir);

const DATA_DIR_NAME = readPortableDataDirName();
const DATA_DIR_MARKER = "请勿删除.txt";

/** 数据目录名的唯一真源是 package.json 的 portableDataDirName（打包脚本也读它）。 */
function readPortableDataDirName() {
  try {
    const name = require("./package.json").portableDataDirName;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  } catch {
    // 读不到就退回字面量，绝不让程序因为一个目录名起不来
  }
  return "EduPlay-用户数据（请勿删除）";
}
// 历史布局，按「新 → 老」顺序探测，命中就把整个目录改名成 DATA_DIR_NAME：
//   [parentDir, "EduPlayData"] —— 曾短暂用过一版，与程序目录并列
//   [exeDir,    "userdata"]    —— 最早的布局，藏在程序目录里面
const LEGACY_DATA_DIRS = [
  [parentDir, "EduPlayData"],
  [exeDir, "userdata"]
];
// 兄弟位置建不出来（父目录只读）时的兜底位置。
const FALLBACK_DATA_DIR_NAME = "userdata";

/** 数据目录放在跨过程序目录的位置；老布局顺手搬过去。 */
function resolvePortableDataRoot() {
  const separated = path.join(parentDir, DATA_DIR_NAME);
  if (fs.existsSync(separated)) {
    return separated; // 已经是当前布局
  }
  for (const [base, name] of LEGACY_DATA_DIRS) {
    const legacy = path.join(base, name);
    if (!fs.existsSync(legacy)) {
      continue;
    }
    try {
      // 老布局就地升级。同盘 rename 是原子操作、不遍历子文件，
      // 内部文件被句柄占着也能成功（fs.cpSync 会失败）。
      // 名字变了不影响页面 origin（origin 只看 127.0.0.1:<端口>），
      // 所以登录态、记住的密码、主题、语言都原地接着用。
      fs.renameSync(legacy, separated);
      return separated;
    } catch {
      return legacy; // 移不动（被占 / 只读）就原地不动，程序照常跑
    }
  }
  return separated; // 全新安装
}

/** 在数据目录里留个说明。文件名刻意用中文：它会夹在一堆英文缓存目录中间，很显眼。 */
function writeDataDirMarker(root) {
  try {
    fs.writeFileSync(
      path.join(root, DATA_DIR_MARKER),
      [
        "EduPlay 的数据都在这个文件夹里，请不要删除。",
        "",
        "里面有：",
        "  - 班级、学生名单和积分",
        "  - 已安装的教学游戏",
        "  - 登录状态和界面设置（主题、语言）",
        "",
        "删除这个文件夹，以上内容会全部清空，无法找回。",
        "",
        "更新程序时：只替换旁边的「EduPlay-便携版」文件夹，",
        "这个文件夹一动都不要动 —— 换新版本后数据会自动沿用，",
        "不需要导出再导入。",
        ""
      ].join("\r\n"),
      "utf8"
    );
  } catch {
    // 写不进去不影响使用
  }
  // 老版本写下的点开头说明文件就地清掉，免得数据目录里躺着两份说明
  // （而且那份是隐藏风格，老师根本不会点开）。
  try {
    fs.rmSync(path.join(root, ".eduplay-data"), { force: true });
  } catch {
    // 删不掉也无所谓
  }
}

if (fs.existsSync(path.join(exeDir, "portable.txt"))) {
  let portableRoot = null;
  try {
    portableRoot = resolvePortableDataRoot();
    fs.mkdirSync(portableRoot, { recursive: true });
  } catch {
    portableRoot = null; // 兄弟位置建不了（父目录只读），下面退回程序目录内
  }
  if (!portableRoot) {
    try {
      portableRoot = path.join(exeDir, FALLBACK_DATA_DIR_NAME);
      fs.mkdirSync(portableRoot, { recursive: true });
    } catch (err) {
      console.error("便携数据目录不可用，已回退到默认目录：", err.message);
    }
  }
  if (portableRoot) {
    app.setPath("userData", portableRoot);
    app.setPath("sessionData", portableRoot);
    writeDataDirMarker(portableRoot);
  }
}

let backendProcess = null;
let mainWindow = null;
let ballWindow = null;
let tray = null;
let currentPort = null;
// 首页地址。刷新/恢复一律回到这个地址，而不是当前地址 —— 万一后端没能提供
// 前端路由兜底，深链接刷新会拿到接口错误页，回首页至少保证程序还能用。
let appUrl = null;

// ── 悬浮球常驻模式 ────────────────────────────────────────────────────
// 桌面壳行为（关窗收起为球、球的位置记忆、是否启动即收起）存在 userData 下
// 的 desktop-settings.json，而非 localStorage（主进程在窗口创建前就要读）或
// 后端 app_settings（那是平台业务表）。详见 docs/floating-ball-mode-design.md。
const DESKTOP_SETTINGS_FILE = "desktop-settings.json";
const DEFAULT_BALL_SIZE = 56;
const BALL_MARGIN = 24;

function readDesktopSettings() {
  try {
    const file = path.join(app.getPath("userData"), DESKTOP_SETTINGS_FILE);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {
    // 配置损坏就退回默认，绝不让程序因为一个配置文件起不来
  }
  return {};
}

function writeDesktopSettings(patch) {
  try {
    const file = path.join(app.getPath("userData"), DESKTOP_SETTINGS_FILE);
    const current = readDesktopSettings();
    const next = { ...current, ...patch };
    fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch {
    return patch;
  }
}

function ballModeEnabled() {
  return readDesktopSettings().ballMode === true;
}

/**
 * 把悬浮球位置钳制到某个显示器的可见工作区内。拔掉副屏 / 改分辨率后，球
 * 可能落在所有屏幕之外（变成「软件消失了」），所以每次显示前都要 clamp。
 */
function clampBallPosition(x, y) {
  const size = DEFAULT_BALL_SIZE;
  const displays = screen.getAllDisplays();
  const candidates = displays.map((d) => d.workArea);
  for (const wa of candidates) {
    if (x >= wa.x && y >= wa.y && x < wa.x + wa.width && y < wa.y + wa.height) {
      return { x, y };
    }
  }
  const primary = screen.getPrimaryDisplay().workArea;
  const snapped = {
    x: primary.x + primary.width - size - BALL_MARGIN,
    y: primary.y + primary.height - size - BALL_MARGIN
  };
  // 若主屏工作区小到放不下，退回左上角，保证球一定可见
  if (snapped.x < primary.x) snapped.x = primary.x + BALL_MARGIN;
  if (snapped.y < primary.y) snapped.y = primary.y + BALL_MARGIN;
  return snapped;
}

function loadBallPosition() {
  const p = readDesktopSettings().ballPosition;
  if (p && typeof p.x === "number" && typeof p.y === "number") {
    return clampBallPosition(p.x, p.y);
  }
  return clampBallPosition(-99999, -99999);
}

function resolveJava() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "jre", "bin", "java.exe");
  }
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, "bin", "java.exe");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "java";
}

/**
 * 32 位构建必须显式给堆参数 —— 这是 32 位与 64 位在"运行期"唯一的差异。
 *
 * 实测（2026-10-11，BellSoft JDK 21.0.12 i586）：
 *   默认 MaxHeapSize = 268435456，即**只有 256 MB**；默认 VM 还是 Client（只有 C1）；
 *   而 32 位进程的用户态地址空间上限约 2 GB。
 * 后端是 Spring Boot + H2 + Flyway，轻载能起来，请求一多就 OOM ——
 * 用户看到的现象是"程序突然自己不见了"，连错误框都来不及弹。
 *
 * 所以 32 位固定给一组"够用且留有余量"的参数，64 位一个都不加：
 *   -Xms64m    启动就占住，避免运行期反复扩容产生的抖动
 *   -Xmx768m   上限；给 metaspace / 线程栈 / 直接内存留下约 1.2 GB 地址空间
 *   -server    显式启用 Server VM（C2）。32 位包里 bin/server/jvm.dll 确实存在，
 *              不加则默认只有 C1，接口延迟会明显变差。
 *
 * 判定依据是 process.arch，而不是"打包时写下的标记"：同一个 main.js 要同时
 * 服务两种产物，运行时自己是什么架构，就用对应参数。
 */
function resolveJvmArgs() {
  if (process.arch === "ia32") {
    return ["-Xms64m", "-Xmx768m", "-server"];
  }
  return [];
}

function resolveJar() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.jar");
  }
  if (process.env.EDUPLAY_BACKEND_JAR) {
    return process.env.EDUPLAY_BACKEND_JAR;
  }

  const candidates = [

    path.join(__dirname, "..", "backend", "target", "eduplay-backend.jar")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * 端口稳定性 —— 「记住密码没效果」的真正原因就在这。
 *
 * 页面是从 http://127.0.0.1:<端口>/ 加载的，而 **localStorage / IndexedDB 是按
 * origin 隔离的，origin 里包含端口**。原来这里每次启动都 listen(0) 让系统随机
 * 分配端口，等于每次都是全新 origin、全新空存储：勾了「记住密码」下次还是空
 * 密码框，主题、语言、登录令牌、红包奖品同样每次都回到默认值。
 *
 * 实测（连续三次启动真实主进程，同一个 userData）：日志里出现了
 *   http://127.0.0.1:51409 / :53358 / :59493  三个互不相通的存储，
 * 三个 origin 下各写了一份 __origin_probe__，但页面上每次都读到 null
 * —— 数据没丢，只是被端口隔开了。
 *
 * 所以改成「记住用过的端口」：候选端口写在 userData/port.txt 里，启动时从
 * 最早记录的开始逐个试探，能绑上就用它 —— origin 不变，本地数据就还在。
 * 只有全都绑不上（端口被别的程序占了）才分配新的、追加到列表末尾。
 *
 * 为什么是「最早优先」而不是「最近优先」：U 盘便携版会在 A/B 两台电脑之间
 * 来回插。若按最近优先，A 电脑用过 51409、B 电脑换到 60123 之后，A 电脑下次
 * 会先试 60123 并成功 —— origin 就漂了。按最早优先，两台电脑各自都会停在
 * 自己那台机器上一直可用的那个端口，origin 保持稳定。
 */
const PORT_RECORD_FILE = "port.txt";
const PORT_CANDIDATE_LIMIT = 16;

function portRecordPath() {
  return path.join(app.getPath("userData"), PORT_RECORD_FILE);
}

function readPortCandidates() {
  try {
    return fs
      .readFileSync(portRecordPath(), "utf8")
      .split(/[^0-9]+/)
      .map((token) => Number.parseInt(token, 10))
      .filter((port) => Number.isInteger(port) && port > 1024 && port < 65536)
      .slice(0, PORT_CANDIDATE_LIMIT);
  } catch {
    // 首次启动、记录被删或损坏：走下面的重新分配
    return [];
  }
}

/** 端口空闲则返回它，被占用返回 null。 */
function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      server.close(() => resolve(actual));
    });
  });
}

function rememberPort(port, previous) {
  // 新端口排在**末尾**：列表按「最早用过」排序，启动时从最早的开始试，
  // 这样每台电脑都稳定停在自己一直可用的那个端口上，origin 不会漂。
  // 若改成最近优先，A 电脑用过 51409、B 电脑换到 60123 之后，A 电脑下次
  // 会先试 60123 且成功 —— origin 就漂到 B 的存储上去了。
  const next = [...previous.filter((item) => item !== port), port].slice(
    0,
    PORT_CANDIDATE_LIMIT
  );
  try {
    fs.writeFileSync(portRecordPath(), next.map(String).join("\n"), "utf8");
  } catch {
    // 写不进去也不影响本次启动
  }
}

/**
 * 从 Chromium 的 Local Storage 里把「历史上用过的 origin」捞回来。
 *
 * 装在 U 盘上的老版本没有 port.txt，但 leveldb 文件里留着写入时的 origin
 * 前缀（http://127.0.0.1:<端口>）。升级到本版本后第一次启动时复用其中最近
 * 用过的那个端口，此前的登录态 / 记住的密码 / 主题就能原地接上，而不是
 * 「更新一次、设置重置一次」。
 *
 * 排序依据：文件按修改时间升序拼接后取每个端口**最后出现的位置**，
 * 越靠后说明越近被写过。
 */
function discoverPortsFromStorage() {
  const dir = path.join(app.getPath("userData"), "Local Storage", "leveldb");
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => /\.(log|ldb)$/i.test(name))
      .map((name) => {
        const full = path.join(dir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          // 读不到时间就当最旧
        }
        return { full, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);
  } catch {
    return [];
  }

  const lastSeenAt = new Map();
  let offsetBase = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full).toString("latin1");
    } catch {
      continue;
    }
    const pattern = /http:\/\/127\.0\.0\.1:(\d+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const port = Number.parseInt(match[1], 10);
      if (Number.isInteger(port) && port > 1024 && port < 65536) {
        lastSeenAt.set(port, offsetBase + match.index);
      }
    }
    offsetBase += text.length + 1_000_000;
  }

  return [...lastSeenAt.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([port]) => port)
    .slice(0, PORT_CANDIDATE_LIMIT);
}

/**
 * 记录一次「端口漂移」。
 * 它意味着这台机器上此前的本地设置（登录态 / 记住的密码 / 主题）读不回来了，
 * 用户看到的是「设置莫名其妙被重置」。留个痕，方便事后定位而不是靠猜。
 */
function notePortDrift(previousPorts, port) {
  try {
    const dataDir = resolveDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(
      path.join(dataDir, "port-history.log"),
      `${new Date().toISOString()}  端口回退：${previousPorts.join(", ")} 均被占用 -> 改用 ${port}\n`,
      "utf8"
    );
  } catch {
    // 尽力而为
  }
}

async function resolveStablePort() {
  const recorded = readPortCandidates();
  // 没有记录（例如刚从老版本升级上来）就去存储文件里找回历史端口
  const candidates = recorded.length > 0 ? recorded : discoverPortsFromStorage();

  for (const candidate of candidates) {
    const available = await probePort(candidate);
    if (available) {
      if (recorded.length === 0) {
        // 找回成功：立刻固化，之后只认它，不必每次都扫描存储
        rememberPort(available, []);
      }
      return { port: available, drifted: false };
    }
  }

  const fresh = await findFreePort();
  rememberPort(fresh, candidates);
  if (candidates.length > 0) {
    notePortDrift(candidates, fresh);
    console.warn(
      `记录中的端口均被占用（${candidates.join(", ")}），本次改用 ${fresh}`
    );
  }
  return { port: fresh, drifted: candidates.length > 0 };
}

async function waitForBackend(url, timeoutMs = 120000, logPath = "") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        return;
      }
    } catch {
      // backend 尚未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地后端启动超时。请打开日志查看原因：${logPath}`);
}

async function startBackend(port) {
  const java = resolveJava();
  const jar = resolveJar();
  if (!jar || !fs.existsSync(jar)) {
    throw new Error(
      "找不到本地后端 jar，请先执行后端打包：cd backend && mvn -DskipTests package"
    );
  }

  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const logPath = path.join(dataDir, "backend.log");
  const logStream = fs.createWriteStream(logPath, { flags: "w" });

  backendProcess = spawn(
    java,
    [...resolveJvmArgs(), "-jar", jar, `--server.port=${port}`],
    {
      cwd: dataDir,
      env: {
        ...process.env,
        EDUPLAY_PLUGIN_PACKAGE_DIR: path.join(dataDir, "plugins", "packages"),
        EDUPLAY_PLUGIN_INSTALL_DIR: path.join(dataDir, "plugins", "installed")
      },
      stdio: "pipe",
      windowsHide: true
    }
  );

  if (app.isPackaged) {
    backendProcess.stdout?.pipe(logStream);
    backendProcess.stderr?.pipe(logStream);
  } else {
    backendProcess.stdout?.pipe(process.stdout);
    backendProcess.stderr?.pipe(process.stderr);
  }

  backendProcess.on("error", (err) => {
    logStream.end();
    dialog.showErrorBox(
      "EduPlay 本地服务启动失败",
      `无法启动本地后端：${err.message}`
    );
    app.quit();
  });

  backendProcess.on("exit", (code) => {
    backendProcess = null;
    logStream.end();
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "EduPlay 本地服务已退出",
        `本地后端意外退出（代码：${code ?? "未知"}），程序即将关闭。`
      );
      app.quit();
    }
  });

  await waitForBackend(`http://127.0.0.1:${port}/api/v1/health`, 120000, logPath);
}

/**
 * 「重新加载」并不总能奏效。
 *
 * 实测（桌面壳验证脚本 D4）：页面卡在死循环里时，reload 只是把导航排进队列，
 * 渲染进程一直不 ack，页面照样纹丝不动 —— 连续两次 reload 都无效，
 * 只有先 forcefullyCrashRenderer() 把渲染进程干掉、让 Electron 重建一个，
 * 再 reload 才能救回来。
 *
 * 所以这里做两级：先正常 reload，若在 RELOAD_GRACE_MS 内没有加载完成，
 * 就升级成「强制结束渲染进程 → 重新加载」。
 * 这也让 Ctrl+R / F5 在页面卡死时依然是一根真正管用的救命绳。
 */
const RELOAD_GRACE_MS = 4000;

/** 时间窗内允许的「自愈式强制崩溃」次数。超过说明怎么崩都救不回来，别再刷屏。 */
const SELF_HEAL_WINDOW_MS = 60000;
const MAX_SELF_HEAL_IN_WINDOW = 3;
const selfHealTimestamps = [];

/** 最近一次「为了解开卡死而主动崩掉渲染进程」的时间戳，用于区分自愈与真崩溃 */
let selfInflictedCrashAt = 0;

function takeSelfHealQuota() {
  const now = Date.now();
  while (selfHealTimestamps.length > 0 && now - selfHealTimestamps[0] > SELF_HEAL_WINDOW_MS) {
    selfHealTimestamps.shift();
  }
  if (selfHealTimestamps.length >= MAX_SELF_HEAL_IN_WINDOW) {
    return false;
  }
  selfHealTimestamps.push(now);
  return true;
}

function reloadWithEscalation(win, options = {}) {
  const wc = win.webContents;
  if (wc.isDestroyed()) {
    return;
  }

  let loaded = false;
  const onLoaded = () => {
    loaded = true;
  };
  wc.once("did-finish-load", onLoaded);

  if (options.ignoreCache) {
    wc.reloadIgnoringCache();
  } else {
    wc.reload();
  }

  setTimeout(() => {
    wc.removeListener("did-finish-load", onLoaded);
    if (loaded || wc.isDestroyed()) {
      return;
    }
    // 第一级无效：主动崩掉渲染进程（Electron 会重建），再重新加载。
    // render-process-gone 会靠上面那个时间戳认出这是自愈动作，不弹「已崩溃」。
    if (!takeSelfHealQuota()) {
      // 一分钟内崩了三次都没救回来 —— 别再无限循环，交给用户重启
      dialog.showErrorBox(
        "EduPlay 无法自动恢复",
        "页面反复无响应，自动重新加载已尝试多次仍未成功。\n" +
          "请关闭程序后重新打开；若仍不行，请查看本地服务日志：\n" +
          path.join(resolveDataDir(), "backend.log")
      );
      app.quit();
      return;
    }
    selfInflictedCrashAt = Date.now();
    wc.forcefullyCrashRenderer();
    setTimeout(() => {
      if (!wc.isDestroyed()) {
        wc.reload();
      }
    }, 1500);
  }, RELOAD_GRACE_MS);
}

/**
 * 键盘快捷键。
 *
 * 为什么必须自己挂：createWindow 里调了 Menu.setApplicationMenu(null)，而
 * **Electron 的快捷键是靠菜单项注册的** —— 默认菜单（含 View → Reload / Force
 * Reload / Toggle DevTools）一旦删掉，Ctrl+R / F5 / F12 就全部失效。
 * 浏览器里 F5 能用，是因为浏览器外壳自己提供了这个功能；Electron 没有外壳，
 * 不挂就等于没有。
 */
function registerKeyboardShortcuts(win) {
  win.webContents.on("before-input-event", (event, input) => {
    // keyDown 与 keyUp 都会触发，不滤掉会执行两次
    if (input.type !== "keyDown") {
      return;
    }
    const key = (input.key || "").toLowerCase();
    const ctrlOrCmd = input.control || input.meta;

    if (ctrlOrCmd && key === "r") {
      event.preventDefault();
      // Ctrl+Shift+R 连缓存一起绕过，用于「资源改了但没生效」的场合
      reloadWithEscalation(win, { ignoreCache: input.shift });
      return;
    }

    if (input.key === "F5") {
      event.preventDefault();
      reloadWithEscalation(win);
      return;
    }

    // 开发者工具只在未打包时开放：学生机不需要，也不该被随手按出来
    if (!app.isPackaged
        && (input.key === "F12" || (ctrlOrCmd && input.shift && key === "i"))) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
}

/**
 * 「突然卡住 / 崩了」的兜底。
 *
 * 关键认知：**渲染进程卡死时，页面里的任何按钮都点不动** —— 事件循环已经死了，
 * 放在 React 里的「重新加载」按钮根本收不到点击。所以这一层只能在主进程做，
 * 用原生对话框让用户选择（Chromium 给浏览器画的「页面无响应」提示条，也是在这一层做的）。
 *
 * 三种情况要分开，因为触发源不同：
 *   unresponsive          活着但不响应（死循环 / 长任务占住事件循环）
 *   render-process-gone   进程真的没了（崩溃 / 被 OOM 杀 / 被系统杀）
 *   did-fail-load         网络层就没拿到页面（本地服务还没起来 / 连接被断）
 */
function registerRecoveryHandlers(win) {
  const wc = win.webContents;
  let unresponsiveDialogOpen = false;

  /**
   * 弹一个原生对话框，并按用户的选择执行。
   *
   * ⚠ handlers.cancel 必须给「不退出程序」的那些对话框显式传进来：
   * 早先这里是「response !== 0 一律 app.quit()」，于是「页面没有响应」框里
   * 点「再等一会儿」会把程序直接关掉 —— 这跟按钮上的字完全相反。
   * 现在只有明确写「退出程序」的对话框才走默认的 quit 分支。
   */
  async function ask(options, handlers) {
    try {
      const { response } = await dialog.showMessageBox(win, options);
      if (win.isDestroyed()) {
        return;
      }
      if (response === 0) {
        handlers.confirm();
      } else if (handlers.cancel) {
        handlers.cancel();
      } else {
        app.quit();
      }
    } catch {
      // 窗口已销毁 / 对话框被系统取消：忽略
    }
  }

  wc.on("unresponsive", () => {
    if (unresponsiveDialogOpen || win.isDestroyed()) {
      return;
    }
    unresponsiveDialogOpen = true;
    void ask(
      {
        type: "warning",
        noLink: true,
        buttons: ["重新加载", "再等一会儿"],
        defaultId: 0,
        cancelId: 1,
        title: "EduPlay",
        message: "页面没有响应",
        detail:
          "界面暂时没有响应。可以再等一会儿；如果一直不动，重新加载通常能恢复。" +
          "已经结算的成绩保存在本地数据库中，不会丢。"
      },
      {
        confirm: () => {
          unresponsiveDialogOpen = false;
          reloadWithEscalation(win);
        },
        // 「再等一会儿」= 什么都不做，绝不能把程序关掉
        cancel: () => {
          unresponsiveDialogOpen = false;
        }
      }
    ).finally(() => {
      unresponsiveDialogOpen = false;
    });
  });

  // 缓过来了：清掉标记，以后再卡还能再提示一次
  wc.on("responsive", () => {
    unresponsiveDialogOpen = false;
  });

  wc.on("render-process-gone", (_event, details) => {
    unresponsiveDialogOpen = false;
    if (win.isDestroyed()) {
      return;
    }
    // 自愈流程里我们自己崩掉的渲染进程：静默重建，别再弹一个「页面已崩溃」吓人
    if (Date.now() - selfInflictedCrashAt < 8000) {
      reloadWithEscalation(win);
      return;
    }
    const reason = details && details.reason ? details.reason : "unknown";
    void ask(
      {
        type: "error",
        noLink: true,
        buttons: ["重新加载", "退出程序"],
        defaultId: 0,
        cancelId: 1,
        title: "EduPlay",
        message: "页面已崩溃",
        detail:
          `崩溃原因：${reason}。学生名单与积分保存在本地数据库中，` +
          "重新加载不会丢失。若反复崩溃，请查看本地服务日志：" +
          path.join(resolveDataDir(), "backend.log")
      },
      { confirm: () => reloadWithEscalation(win) }
    );
  });

  let retried = false;
  // 加载成功就把「已静默重试过」的标记清掉，否则一次失败之后，
  // 以后任何一次偶发失败都会直接跳对话框，静默重试就永远失效了。
  wc.on("did-finish-load", () => {
    retried = false;
  });
  wc.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 = ERR_ABORTED：正常导航被新导航取代时也会触发，不是错误
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    if (!retried) {
      // 本地服务刚就绪时偶发连不上，先悄悄重试一次，不打扰用户
      retried = true;
      setTimeout(() => {
        if (!win.isDestroyed() && appUrl) {
          win.loadURL(appUrl);
        }
      }, 800);
      return;
    }
    retried = false;
    void ask(
      {
        type: "error",
        noLink: true,
        buttons: ["重试", "退出程序"],
        defaultId: 0,
        cancelId: 1,
        title: "EduPlay",
        message: "页面加载失败",
        detail:
          `EduPlay 页面加载失败：${errorDescription}（${errorCode}）。` +
          "本地服务日志：" + path.join(resolveDataDir(), "backend.log")
      },
      { confirm: () => { if (appUrl) win.loadURL(appUrl); } }
    );
  });
}

/**
 * 启动过渡页：双击后立刻可见，把「后端没就绪 = 全程黑屏」变成「有反馈的等待」。
 * 实测（2026-09-22）：本地 SSD 后端就绪要 7.8~9.6 秒，U 盘 2.0 + 杀软的机器更久。
 * 用 data: 内联，不新增打包产物；秒数计时器让老师确认程序没有卡死。
 */
const SPLASH_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
    background: #f5f7fa; color: #1f2937;
  }
  .wrap { text-align: center; }
  .spinner {
    width: 42px; height: 42px; margin: 0 auto 22px;
    border: 4px solid #dbe3ee; border-top-color: #2f6fed; border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; }
  p { font-size: 13px; color: #6b7280; margin: 4px 0; line-height: 1.7; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="spinner"></div>
    <h1>EduPlay 正在启动</h1>
    <p>正在准备本地教学服务，请稍候</p>
    <p id="timer">已等待 0 秒</p>
    <p>首次在新电脑上启动约需 30–60 秒（与 U 盘速度、杀毒软件有关）</p>
  </div>
  <script>
    var start = Date.now();
    var el = document.getElementById("timer");
    setInterval(function () {
      el.textContent = "已等待 " + Math.round((Date.now() - start) / 1000) + " 秒";
    }, 1000);
  </script>
</body>
</html>`;

async function createWindow() {
  Menu.setApplicationMenu(null);

  // ① 窗口先行：立刻加载内联启动页，双击约 1 秒内就有可见反馈，
  //    而不是等后端健康检查通过才见到界面（那要 8 秒起步，U 盘机更久）。
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f7fa",
    title: "EduPlay",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (ballModeEnabled() && readDesktopSettings().startMinimized) {
      // 启动即收起：不闪一下主窗，直接交给悬浮球
      mainWindow?.hide();
      showBall();
    } else {
      mainWindow?.show();
    }
  });

  // 球模式：点 ✕ 是「收起为悬浮球」，不是退出。后端保持运行。
  // 关键：这里只拦截 close，绝不调 stopBackend —— hide() 不触发 closed，
  // 真正销毁时（完全退出）由 before-quit 统一清理后端。
  mainWindow.on("close", (event) => {
    if (ballModeEnabled() && !app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      showBall();
    }
  });

  registerKeyboardShortcuts(mainWindow);
  registerRecoveryHandlers(mainWindow);

  await mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`
  );

  // ② 幕后起后端：端口稳定策略与超时逻辑原样不动。
  const { port } = await resolveStablePort();
  currentPort = port;
  await startBackend(port);

  // ③ 后端就绪，切到真实页面。
  appUrl = `http://127.0.0.1:${port}/`;
  await mainWindow.loadURL(appUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
    // 不再在这里无条件 stopBackend：球模式下主窗销毁时后端仍要为球服务。
    // 真正的后端清理统一走 before-quit。仅当球模式未开启时，主窗关闭才意味着退出。
    if (!ballModeEnabled()) {
      stopBackend();
    }
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    try {
      backendProcess.kill();
    } catch {
      // ignore
    }
  }
  backendProcess = null;
}

// ── 悬浮球窗口生命周期 ────────────────────────────────────────────────

function resolveBallLogo() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "ball-logo.png");
  }
  return path.join(__dirname, "build", "ball-logo.png");
}

// ── 球窗尺寸守卫 ──────────────────────────────────────────────────────
// 球窗只有 56×56，任何"外部"改动都会让它肉眼变小：
//   ① Windows 按显示器 DPI 重算窗口矩形（高缩放下 WM_DPICHANGED 会把窗口
//      按新比例改大小）；
//   ② Chromium 的页面缩放被持久化 —— 球是 alwaysOnTop 的，光标停在球上时
//      按 Ctrl+滚轮 / 触控板双指捏合，zoomFactor 会从 1 掉到 0.5、0.25，
//      而且这个值按 origin 记在 userData 里，下次启动还是小的；
//   ③ 第三方窗口工具（对齐/贴边软件）强行 setBounds。
// 光靠 CSS 挡不住 ①②，所以在主进程里钉死尺寸 + 自检纠正，并把每次纠正
// 连同当时的 DPI scale 写进 ball-debug.log，方便事后判断到底是哪一类。
function ballLog(tag, detail) {
  try {
    const line = `[${new Date().toISOString()}] ${tag} ${detail}\n`;
    fs.appendFileSync(path.join(app.getPath("userData"), "ball-debug.log"), line, "utf8");
  } catch {
    // 日志写不进去也不能影响球本身
  }
}

let ballSizeGuardTimer = null;
let ballSizeFixing = false;

/**
 * 把球窗的尺寸与页面缩放拉回基准值。返回非空字符串表示"这次真的修过"，
 * 同时已写日志；返回空串表示本来就正常。
 */
function ensureBallSize(trigger) {
  if (!ballWindow || ballWindow.isDestroyed() || ballSizeFixing) return "";
  let bounds;
  try {
    bounds = ballWindow.getBounds();
  } catch {
    return "";
  }
  const notes = [];
  if (bounds.width !== DEFAULT_BALL_SIZE || bounds.height !== DEFAULT_BALL_SIZE) {
    notes.push(`bounds=${bounds.width}x${bounds.height}->${DEFAULT_BALL_SIZE}`);
    ballSizeFixing = true;
    try {
      ballWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: DEFAULT_BALL_SIZE,
        height: DEFAULT_BALL_SIZE
      }, false);
    } catch {
      // 窗口正在销毁/最小化时可能抛，忽略即可
    }
    ballSizeFixing = false;
  }
  try {
    const zoom = ballWindow.webContents.getZoomFactor();
    if (Math.abs(zoom - 1) > 0.005) {
      notes.push(`zoom=${zoom.toFixed(3)}->1`);
      ballWindow.webContents.setZoomFactor(1);
    }
  } catch {
    // webContents 已销毁
  }
  if (!notes.length) return "";
  let dpi = "?";
  try {
    dpi = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).scaleFactor;
  } catch {
    // 取不到就留 ?
  }
  const detail = `${trigger} dpi=${dpi} ${notes.join(" ")}`;
  ballLog("SIZE-FIX", detail);
  return detail;
}

/**
 * 2 秒一次的自检。只在球可见时检查 —— 隐藏着被改小也无所谓，
 * 每次 showBall() 前还会主动纠正一次。
 */
function startBallSizeGuard() {
  if (ballSizeGuardTimer) return;
  ballSizeGuardTimer = setInterval(() => {
    if (!ballWindow || ballWindow.isDestroyed()) {
      stopBallSizeGuard();
      return;
    }
    if (!ballWindow.isVisible()) return;
    ensureBallSize("watchdog");
  }, 2000);
}

function stopBallSizeGuard() {
  if (ballSizeGuardTimer) {
    clearInterval(ballSizeGuardTimer);
    ballSizeGuardTimer = null;
  }
}

function createBallWindow() {
  const { x, y } = loadBallPosition();
  ballWindow = new BrowserWindow({
    width: DEFAULT_BALL_SIZE,
    height: DEFAULT_BALL_SIZE,
    x,
    y,
    // 56 指的是"网页视口"，不是"含边框的窗口"：含边框时 Windows 会给无边框窗
    // 预留一圈不可见的尺寸，内容区拿不到完整的 56。
    useContentSize: true,
    // 四个方向都锁死：外部任何"把窗口改大/改小"的企图都会被 WM_GETMINMAXINFO 挡掉
    minWidth: DEFAULT_BALL_SIZE,
    minHeight: DEFAULT_BALL_SIZE,
    maxWidth: DEFAULT_BALL_SIZE,
    maxHeight: DEFAULT_BALL_SIZE,
    frame: false,
    transparent: true,
    // 透明小窗必须显式给全透明底色：不写时 Windows 会给窗口一个默认的
    // 不透明底色（亮色主题下是白色），在球周围形成一圈方形底块/阴影。
    backgroundColor: "#00000000",
    // thickFrame:false 去掉 WS_THICKFRAME，DWM 就不会再给这个无边框窗
    // 绘制系统级投影（hasShadow:false 在部分 Windows/Electron 组合下不足）。
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 页面缩放从 1 起步，且下面 did-finish-load 会再钉一次
      zoomFactor: 1,
      preload: path.join(__dirname, "preload.js")
    }
  });
  ballWindow.setAlwaysOnTop(true, "screen-saver");
  // 双保险：显式声明无系统阴影 + 全透明底色（上面 options 已设，这里再落一次）
  ballWindow.setHasShadow(false);
  try { ballWindow.setBackgroundColor("#00000000"); } catch { /* 老版本无此方法时忽略 */ }
  try {
    ballWindow.setMinimumSize(DEFAULT_BALL_SIZE, DEFAULT_BALL_SIZE);
    ballWindow.setMaximumSize(DEFAULT_BALL_SIZE, DEFAULT_BALL_SIZE);
  } catch {
    // 个别平台上 setMaximumSize 对无边框窗无效，靠下面的守卫兜底
  }

  ballWindow.loadFile(path.join(__dirname, "ball.html"));

  // ── 球窗口诊断日志 ──────────────────────────────────────────────
  // 球是无边框透明小窗，出问题时界面上没有任何报错入口。把 preload 异常、
  // 页面加载失败、渲染进程 console 落到 userData/ball-debug.log，
  // 这样「logo 不显示 / 拖不动 / 变小」能直接看到原因，不用靠猜。
  ballWindow.webContents.on("preload-error", (_e, preloadPath, error) => {
    ballLog("PRELOAD-ERROR", `${preloadPath} :: ${error && error.message}`);
  });
  ballWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    ballLog("DID-FAIL-LOAD", `${code} ${desc} ${url}`);
  });
  ballWindow.webContents.on("render-process-gone", (_e, details) => {
    ballLog("RENDER-GONE", `${details.reason} exitCode=${details.exitCode}`);
  });
  ballWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    // Electron 新版把 console-message 的参数合并成一个 details 对象，这里兼容两种签名
    if (level && typeof level === "object") {
      ballLog(`CONSOLE-${level.level}`, `${level.message} (${level.sourceId}:${level.lineNumber})`);
    } else {
      ballLog(`CONSOLE-${level}`, `${message} (${sourceId}:${line})`);
    }
  });
  // Ctrl+滚轮 / 双指捏合缩放是「过一会变小」最可疑的来源：这个 zoom 值会按
  // origin 存进 userData，越缩越小且重启后仍然生效。捕获到就立刻拉回 1。
  if (typeof ballWindow.webContents.on === "function") {
    ballWindow.webContents.on("zoom-changed", (_e, direction) => {
      ballLog("ZOOM-CHANGED", `direction=${direction}`);
      ensureBallSize("zoom-changed");
    });
  }
  ballWindow.webContents.on("did-finish-load", () => {
    try {
      ballWindow.webContents.setVisualZoomLevelLimits(1, 1); // 禁止捏合缩放
      ballWindow.webContents.setZoomFactor(1);
    } catch {
      // 老版本没有该 API 时忽略
    }
    const b = ballWindow.getBounds();
    let dpi = "?";
    try { dpi = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).scaleFactor; } catch { /* 忽略 */ }
    ballLog("DID-FINISH-LOAD", `${path.join(__dirname, "ball.html")} bounds=${b.width}x${b.height} dpi=${dpi}`);
    ensureBallSize("did-finish-load");
    startBallSizeGuard();
  });

  // 窗口被外部改尺寸的那一刻就纠正，不用等 2 秒的 watchdog。
  // 节流 800ms：如果某个外部因素在反复改尺寸，避免 setBounds 与 resize 事件
  // 互相触发成死循环（剩下的交给 watchdog 兜）。
  let lastResizeFixAt = 0;
  ballWindow.on("resize", () => {
    if (ballSizeFixing) return;
    const now = Date.now();
    if (now - lastResizeFixAt < 800) return;
    lastResizeFixAt = now;
    ensureBallSize("resize");
  });

  // 拖动结束即持久化位置（下次启动回到这里）。挂在创建处，重建球窗口也能带上。
  ballWindow.on("moved", () => {
    const [x, y] = ballWindow.getPosition();
    writeDesktopSettings({ ballPosition: { x, y } });
  });

  // 收起状态下主窗被销毁（例如用户从托盘退出前主窗已关）时，球仍在；
  // 球自己「关闭」不代表退出——只有显式「完全退出」才杀后端。
  ballWindow.on("closed", () => {
    stopBallSizeGuard();
    ballWindow = null;
  });
}

function showBall() {
  if (!ballWindow || ballWindow.isDestroyed()) {
    createBallWindow();
  }
  const { x, y } = loadBallPosition();
  // 先按基准尺寸落位再显示：被外部改小的窗口如果先显示再纠正，
  // 用户会看到"先小一下再弹回"的抖动。
  ensureBallSize("show");
  ballWindow.setPosition(x, y);
  ballWindow.showInactive();
  // showInactive 之后 Windows 可能重新算一次 DPI 矩形，再钉一次。
  setImmediate(() => ensureBallSize("after-show"));
}

function hideBall() {
  if (!ballWindow || ballWindow.isDestroyed()) return;
  ballWindow.hide();
  // ⚠️ win32 已确认缺陷（electron/electron#41063）：`frame:false` + `transparent:true`
  // 的窗口，**每调用一次 hide() 就会被系统缩掉 64×64 px**（minimize() 同理），
  // 而且是同步发生的："起初大小正常，用几次之后变得特别小" 就是它 ——
  // 56px 的球减 64 直接归零。min/max 尺寸锁能挡住大部分，但挡不全，
  // 所以 hide 之后必须立刻把尺寸补回来，再延迟补一次（系统有时延迟应用那次 resize）。
  ensureBallSize("after-hide");
  setTimeout(() => ensureBallSize("after-hide-late"), 150);
}

function expandFromBall() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // 主窗已被销毁（低内存模式将来可能走到这里）：重建并加载首页
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hideBall();
}

function collapseToBall() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  showBall();
}

function quitCompletely() {
  stopBackend();
  app.quit();
}

// ── 托盘（球模式下「完全退出」的兜底入口）──────────────────────────
function createTray() {
  try {
    // 用悬浮球 logo 做托盘图标：它在 extraResources 里随包分发，
    // 打包/未打包两种模式都能取到，避免依赖只在打包期存在的 icon.ico。
    const icon = nativeImage.createFromPath(resolveBallLogo());
    tray = new Tray(icon);
    const menu = MenuBuilder.buildFromTemplate([
      { label: "打开 EduPlay", click: () => expandFromBall() },
      { label: "收起为悬浮球", click: () => collapseToBall() },
      { type: "separator" },
      { label: "完全退出", click: () => quitCompletely() }
    ]);
    tray.setToolTip("EduPlay");
    tray.setContextMenu(menu);
    tray.on("click", () => expandFromBall());
  } catch {
    // 托盘图标缺失不致命，球本身仍是入口
    tray = null;
  }
}

// ── IPC 通道（悬浮球 <-> 主进程、设置页 <-> 主进程）────────────────
function registerBallIpc() {
  // 球侧
  ipcMain.handle("ball:expand", () => expandFromBall());

  // ── 拖拽三段式 ────────────────────────────────────────────────
  // 坐标全部由主进程用 screen.getCursorScreenPoint() 取：渲染进程的
  // e.screenX 是 CSS 像素，与 setPosition 的物理像素在 Windows 高分屏缩放下
  // 会错位，直接拿它定位就会"拖不动"或"跳着走"。
  // 记录「按下时的窗口位置 + 光标位置」，之后只按位移量平移，球不会跳。
  let ballDrag = null;
  ipcMain.handle("ball:drag-start", () => {
    if (!ballWindow || ballWindow.isDestroyed()) return;
    const [x, y] = ballWindow.getPosition();
    const p = screen.getCursorScreenPoint();
    ballDrag = { winX: x, winY: y, curX: p.x, curY: p.y };
  });
  ipcMain.handle("ball:drag", () => {
    if (!ballWindow || ballWindow.isDestroyed() || !ballDrag) return;
    const p = screen.getCursorScreenPoint();
    ballWindow.setPosition(
      Math.round(ballDrag.winX + (p.x - ballDrag.curX)),
      Math.round(ballDrag.winY + (p.y - ballDrag.curY))
    );
  });
  ipcMain.handle("ball:drag-end", () => {
    ballDrag = null;
  });

  ipcMain.handle("ball:menu", () => {
    if (tray) tray.popUpContextMenu();
  });
  // 悬浮球 logo：主进程直接读文件转成 data: URL 交给渲染进程。
  // logo 落在 app.asar 之外的 resources/（开发期 build/），用 data: 可以
  // 完全避开 file:// 的 origin 判定与 CSP 细节，最稳。
  ipcMain.handle("ball:logo-url", () => {
    try {
      const buf = fs.readFileSync(resolveBallLogo());
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch (err) {
      console.warn("读取悬浮球 logo 失败：", err);
      return "";
    }
  });
  // 主窗侧：标题栏「收起」/设置里触发
  ipcMain.handle("desktop:collapse", () => collapseToBall());
  ipcMain.handle("desktop:quit", () => quitCompletely());
  // 设置侧
  ipcMain.handle("desktop:get-settings", () => readDesktopSettings());
  ipcMain.handle("desktop:set-setting", (_event, key, value) => {
    const allowed = ["ballMode", "startMinimized"];
    if (!allowed.includes(key)) return readDesktopSettings();
    const next = writeDesktopSettings({ [key]: !!value });
    if (key === "ballMode" && value === true) {
      // 打开球模式时立即把球和托盘挂上，让「收起」随手可用
      if (!ballWindow || ballWindow.isDestroyed()) createBallWindow();
      if (!tray) createTray();
    }
    return next;
  });
}

// ── 单实例锁 ──────────────────────────────────────────────────────────
// 常驻后双击两次 exe 是高概率事件；双开 = 两个 java 抢端口 = 端口漂移 =
// 页面 origin 变端口 → localStorage 全隔离（用户看到「设置被重置」）。
// 第二个实例一律唤起已存在的实例并退出自己。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    expandFromBall();
  });
}

app.whenReady().then(async () => {
  // 丢掉上一次运行留下的 HTTP 缓存。
  //
  // 为什么必须做：后端新版本给 index.html 发了 no-cache（见
  // StaticResourceCacheConfig），但**装在用户机器上的旧版本没有**——那份旧
  // index.html 是按 Last-Modified 启发式缓存的，在它的新鲜期内不会回源校验，
  // 于是升级后打开还是旧界面（旧名字、旧版本号），看起来像「没更新成功」。
  // 缓存落在便携数据目录，动它不影响 localStorage（登录态/主题/语言）。
  // 失败也不该拦住启动：清缓存顶多让本次首屏慢几十毫秒。
  try {
    await session.defaultSession.clearCache();
  } catch (err) {
    console.warn("清理 HTTP 缓存失败（忽略）：", err);
  }

  // 悬浮球：IPC 通道必须无条件注册 —— 设置页的开关在球模式未开启时也要
  // 能读写配置（否则点「悬浮球常驻」会打到未注册的通道，报「操作失败」）。
  registerBallIpc();

  // 球模式已开启（上次留下的配置）才预建球窗口 + 托盘。
  if (ballModeEnabled()) {
    createBallWindow();
    createTray();
  }

  try {
    await createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "EduPlay 启动失败",
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // 球模式下，主窗与球都关了才退出；否则（球还在）继续驻留。
  // 真正的后端清理统一走 before-quit，这里只负责决定退不退出。
  if (!ballModeEnabled() || !ballWindow || ballWindow.isDestroyed()) {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopBackend();
});
