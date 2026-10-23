/// <reference types="vite/client" />

/** 构建期由 vite.config.ts 的 define 注入，值取自 frontend/package.json 的 version。 */
declare const __APP_VERSION__: string;

/** Electron 桌面壳通过 preload.js 注入的能力；网页版没有这个对象。 */
interface Window {
  eduplayDesktop?: {
    version: string;
    platform: string;
    ballExpand: () => Promise<void>;
    ballDragTo: (x: number, y: number) => Promise<void>;
    ballMenu: () => Promise<void>;
    collapseToBall: () => Promise<void>;
    quitApp: () => Promise<void>;
    getDesktopSettings: () => Promise<{ ballMode?: boolean }>;
    setDesktopSetting: (
      key: string,
      value: boolean
    ) => Promise<{ ballMode?: boolean }>;
  };
}

