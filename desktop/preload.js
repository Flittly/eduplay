const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eduplayDesktop", {
  version: process.env.npm_package_version ?? "1.5.2",
  platform: process.platform,
  // 悬浮球 logo 的 data: URL（logo 在 app.asar 之外的 resources/ 里，
  // 由主进程读文件转 base64，避免 file:// 的 origin/CSP 不确定性）
  ballLogoUrl: () => ipcRenderer.invoke("ball:logo-url"),

  // 悬浮球侧（ball.html）
  ballExpand: () => ipcRenderer.invoke("ball:expand"),
  // 拖拽三段式：起点记录窗口与光标、移动只发信号、结束清理。
  // 坐标一律由主进程用 screen.getCursorScreenPoint() 取，避免渲染进程的
  // CSS 像素与 setPosition 的物理像素在高分屏下错位。
  ballDragStart: () => ipcRenderer.invoke("ball:drag-start"),
  ballDrag: () => ipcRenderer.invoke("ball:drag"),
  ballDragEnd: () => ipcRenderer.invoke("ball:drag-end"),
  ballMenu: () => ipcRenderer.invoke("ball:menu"),

  // 主窗侧
  collapseToBall: () => ipcRenderer.invoke("desktop:collapse"),
  quitApp: () => ipcRenderer.invoke("desktop:quit"),

  // 设置侧
  getDesktopSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  setDesktopSetting: (key, value) =>
    ipcRenderer.invoke("desktop:set-setting", key, value)
});
