import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_PROXY_TARGET ?? "http://localhost:8080";
  const cloudApiTarget = env.VITE_CLOUD_PROXY_TARGET ?? "http://localhost:18080";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        },
        "/cloud-api": {
          target: cloudApiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
