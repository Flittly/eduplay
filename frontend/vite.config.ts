import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_PROXY_TARGET ?? "http://localhost:7070";

  return {
    plugins: [react()],
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
