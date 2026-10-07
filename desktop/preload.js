const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("eduplayDesktop", {
  version: process.env.npm_package_version ?? "1.5.1",
  platform: process.platform
});
