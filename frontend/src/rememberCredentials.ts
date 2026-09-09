// "记住密码"凭据存取工具
// 说明：凭据保存在 localStorage 中，仅做 Base64 混淆（防止明文一眼可见），
// 没有加密强度，适用于校内单机/内网场景。保存后不会过期（无限期）。

const PREFIX = "eduplay.savedCredentials.";

export type RememberScope = "local" | "cloud";

export interface SavedCredentials {
  username: string;
  password: string;
}

function storageKey(scope: RememberScope): string {
  return `${PREFIX}${scope}`;
}

function encode(value: string): string {
  // 支持 UTF-8（中文用户名等）
  return btoa(unescape(encodeURIComponent(value)));
}

function decode(value: string): string {
  return decodeURIComponent(escape(atob(value)));
}

export function loadSavedCredentials(
  scope: RememberScope
): SavedCredentials | null {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      u?: string;
      p?: string;
    };
    if (!parsed || typeof parsed.u !== "string" || typeof parsed.p !== "string") {
      return null;
    }
    return {
      username: decode(parsed.u),
      password: decode(parsed.p)
    };
  } catch {
    return null;
  }
}

export function saveCredentials(
  scope: RememberScope,
  credentials: SavedCredentials
): void {
  try {
    localStorage.setItem(
      storageKey(scope),
      JSON.stringify({
        u: encode(credentials.username),
        p: encode(credentials.password)
      })
    );
  } catch {
    // 存储失败（如隐私模式）时静默忽略，不影响登录流程
  }
}

export function clearSavedCredentials(scope: RememberScope): void {
  try {
    localStorage.removeItem(storageKey(scope));
  } catch {
    // 忽略
  }
}
