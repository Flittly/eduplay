const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

let backendProcess = null;
let mainWindow = null;
let currentPort = null;

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

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    dialog.showErrorBox(
      "页面加载失败",
      `EduPlay 页面加载失败：${errorDescription}（${errorCode}）`
    );
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);

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
