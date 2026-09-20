const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

// ── 便携模式（U 盘运行）───────────────────────────────────────────────
// 若 exe 同目录存在 portable.txt，就把 Electron 的用户数据目录整体搬到
// exe 旁边。userData 是「本地数据库 + Chromium 缓存 + localStorage（登录
// 令牌）」的根目录，改这里等于把学生数据和登录状态一并放进 U 盘。
//
// 必须在模块顶层同步执行：app ready 之后 Chromium 的存储路径就已固定，
// 那时再 setPath 不会生效。
const exeDir = path.dirname(process.execPath);
const portableRoot = path.join(exeDir, "userdata");

if (fs.existsSync(path.join(exeDir, "portable.txt"))) {
  try {
    fs.mkdirSync(portableRoot, { recursive: true });
    app.setPath("userData", portableRoot);
    app.setPath("sessionData", portableRoot);
  } catch (err) {
    // U 盘写保护 / 空间不足：退回默认目录，保证程序仍能启动
    console.error("便携数据目录不可用，已回退到默认目录：", err.message);
  }
}

let backendProcess = null;
let mainWindow = null;
let currentPort = null;
// 首页地址。刷新/恢复一律回到这个地址，而不是当前地址 —— 万一后端没能提供
// 前端路由兜底，深链接刷新会拿到接口错误页，回首页至少保证程序还能用。
let appUrl = null;

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
    ["-jar", jar, `--server.port=${port}`],
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
      { confirm: () => win.loadURL(appUrl) }
    );
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);

  const { port } = await resolveStablePort();
  currentPort = port;
  await startBackend(port);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "EduPlay",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  registerKeyboardShortcuts(mainWindow);
  registerRecoveryHandlers(mainWindow);

  appUrl = `http://127.0.0.1:${port}/`;
  await mainWindow.loadURL(appUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopBackend();
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

app.whenReady().then(async () => {
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
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});
