import type {
  ActivationCode,
  AdminStats,
  AdminGame,
  AdminTag,
  AdminUser,
  AuthResult,
  Teacher
} from "./types";

const BASE_URL = "/api/v1/admin";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options?.headers ?? {})
    }
  });
  const body = (await response.json()) as {
    success: boolean;
    message: string;
    data: T;
  };
  if (!response.ok || !body.success) {
    throw new Error(body.message || "请求失败");
  }
  return body.data;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function adminLogin(payload: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return request<AuthResult>("/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function adminMe(token: string): Promise<AdminUser> {
  return request<AdminUser>("/me", { headers: auth(token) });
}

export function adminLogout(token: string): Promise<void> {
  return request<void>("/logout", {
    method: "POST",
    headers: auth(token)
  });
}

export function adminStats(token: string): Promise<AdminStats> {
  return request<AdminStats>("/stats", { headers: auth(token) });
}

export function adminTeachers(
  token: string,
  keyword?: string
): Promise<Teacher[]> {
  const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
  return request<Teacher[]>(`/teachers${query}`, { headers: auth(token) });
}

export function adminUpdateTeacherStatus(
  token: string,
  teacherId: number,
  status: "ACTIVE" | "DISABLED"
): Promise<Teacher> {
  return request<Teacher>(`/teachers/${teacherId}/status`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
}

export function adminResetTeacherPassword(
  token: string,
  teacherId: number,
  newPassword: string
): Promise<Teacher> {
  return request<Teacher>(`/teachers/${teacherId}/reset-password`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ newPassword })
  });
}

export function adminCodes(token: string): Promise<ActivationCode[]> {
  return request<ActivationCode[]>("/codes", { headers: auth(token) });
}

export function adminGenerateCodes(
  token: string,
  gameCode: string,
  count: number
): Promise<ActivationCode[]> {
  return request<ActivationCode[]>("/codes/generate", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ gameCode, count })
  });
}

export async function adminDownloadCodes(token: string) {
  const response = await fetch(`${BASE_URL}/codes/export`, {
    headers: auth(token)
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "activation-codes.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function adminGames(token: string): Promise<AdminGame[]> {
  return request<AdminGame[]>("/games", { headers: auth(token) });
}

export function adminCreateGame(
  token: string,
  payload: {
    gameCode: string;
    name: string;
    description?: string;
    priceCents?: number;
  }
): Promise<AdminGame> {
  return request<AdminGame>("/games", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(payload)
  });
}

export function adminUpdateGameStatus(
  token: string,
  gameId: number,
  status: "DRAFT" | "ACTIVE"
): Promise<AdminGame> {
  return request<AdminGame>(`/games/${gameId}/status`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
}

export function adminUploadGamePackage(
  token: string,
  gameCode: string,
  file: File
): Promise<AdminGame> {
  const form = new FormData();
  form.append("file", file);
  return request<AdminGame>(`/games/${gameCode}/packages`, {
    method: "POST",
    headers: auth(token),
    body: form
  });
}

export function adminTags(token: string): Promise<AdminTag[]> {
  return request<AdminTag[]>("/tags", { headers: auth(token) });
}

export function adminCreateTag(
  token: string,
  payload: {
    category: string;
    code: string;
    name: string;
    sortOrder?: number;
  }
): Promise<AdminTag> {
  return request<AdminTag>("/tags", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(payload)
  });
}

export function adminGameTags(
  token: string,
  gameId: number
): Promise<AdminTag[]> {
  return request<AdminTag[]>(`/games/${gameId}/tags`, {
    headers: auth(token)
  });
}

export function adminSetGameTags(
  token: string,
  gameId: number,
  tagIds: number[]
): Promise<AdminTag[]> {
  return request<AdminTag[]>(`/games/${gameId}/tags`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ tagIds })
  });
}

/**
 * 取服务端在 Content-Disposition 里定下的文件名。
 *
 * 文件名必须由服务端给：导出的字节取自「按版本排序选出的那个包」，而列表里的
 * game.version 是「最近一次上传的 manifest 版本」，两者在版本排序与上传顺序不一致时
 * 会分叉，前端自己拼会拼出与包内容不符的版本号。
 * 同源部署（BASE_URL 是相对路径），所以这个响应头读得到。
 */
function attachmentFileName(header: string | null, fallback: string): string {
  if (!header) {
    // 走到这里说明服务端没给文件名（例如前端先于后端上线），
    // 结果会是不带版本号的老命名——别静默糊过去。
    console.warn("[admin] 导出响应缺少 Content-Disposition，回退到不带版本号的文件名");
    return fallback;
  }
  // Spring 带 charset 时会同时给 filename*=UTF-8''…（RFC 5987）与 filename="…"，优先前者
  const extended = /filename\*=UTF-8''([^;]*)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* 转义不合法则退回下面的普通 filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

export async function adminExportTaggedPackage(token: string, gameCode: string) {
  const response = await fetch(`${BASE_URL}/games/${gameCode}/package/export`, {
    headers: auth(token)
  });
  if (!response.ok) {
    throw new Error("导出失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachmentFileName(
    response.headers.get("Content-Disposition"),
    `${gameCode}-tagged.zip`
  );
  link.click();
  URL.revokeObjectURL(url);
}