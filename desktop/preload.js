const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("eduplayDesktop", {
  version: process.env.npm_package_version ?? "1.1.0",
  platform: process.platform
});
