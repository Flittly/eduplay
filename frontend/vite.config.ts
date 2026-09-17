import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 平台版本号的构建期真源：frontend/package.json 的 version。
// 用 import.meta.url 定位，避免依赖构建时的工作目录。
const configDir = dirname(fileURLToPath(import.meta.url));
const { version: platformVersion } = JSON.parse(
  readFileSync(resolve(configDir, "package.json"), "utf-8")
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_PROXY_TARGET ?? "http://localhost:7070";

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(platformVersion)
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        },
        // 云端请求统一走本地后端的 CloudApiProxyController 转发，
        // 这样设置页配置的云端地址在开发模式与打包版行为一致
        "/cloud-api": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
