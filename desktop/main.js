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

  const port = await findFreePort();
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
