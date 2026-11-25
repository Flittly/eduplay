import { invalidateRosterAfter } from "./rosterStore";
import type {
  ApiResponse,
  AuthResult,
  ClassSummary,
  GameManifest,
  GameScoreResult,
  InstalledGame,
  RedeemResult,
  Student,
  StudentPointsDetail,
  StudentPointsResponse,
  StudentImportResult,
  StoreGame,
  User,
  PlatformSettings
} from "./types";

const BASE_URL = "/api/v1";
const CLOUD_BASE_URL = "/cloud-api/api/v1";

/** JSON 接口的默认超时。后端卡死时不能让界面永远转圈。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 带 HTTP 状态码的接口错误。
 * 调用方需要区分「令牌失效（401/403）」和「后端没起来 / 网络抖动」——
 * 前者该清登录态，后者不该。所以状态码必须带出来，不能只留 message。
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
  baseUrl: string = BASE_URL
): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  // 上传插件包这类 FormData 请求不设默认超时：学校机器上几十 MB 的包
  // 传几十秒很正常，超时重试反而会让老师以为安装失败。
  const withTimeout = !isFormData && !options?.signal;
  const controller = withTimeout ? new AbortController() : null;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    : null;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller?.signal ?? options?.signal,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options?.headers ?? {})
      }
    });
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new ApiError("请求超时，请检查后端服务是否正常", 0);
    }
    throw err;
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    // 响应体为空或非 JSON：多为服务未启动、代理目标不可达
    throw new ApiError("服务无响应，请确认后端服务已启动", response.status);
  }

  if (!response.ok || !body.success) {
    throw new ApiError(body.message || "请求失败", response.status);
  }

  return body.data;
}

export function registerLocal(payload: {
  username: string;
  password: string;
  nickname?: string;
  role?: string;
  studentNo?: string;
  className?: string;
  phone?: string;
  email?: string;
  gender?: string;
  birthday?: string;
}): Promise<AuthResult> {
  return request<AuthResult>("/auth/local/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateProfile(
  token: string,
  payload: {
    nickname?: string;
    phone?: string;
    email?: string;
    gender?: string;
    birthday?: string;
  }
): Promise<User> {
  return request<User>("/auth/profile", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

export function loginLocal(payload: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return request<AuthResult>("/auth/local/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getCurrentUser(token: string): Promise<User> {
  return request<User>("/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function logout(token: string): Promise<void> {
  return request<void>("/auth/logout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

/**
 * 改名单的写操作统一用 `invalidateRosterAfter` 包一层：
 * 成功后通知「名单已变」，让正在听着的地方（浮窗随机点名的班级下拉）重新取数。
 * 见 `rosterStore.ts`。
 */
export function importStudents(
  file: File,
  token: string
): Promise<StudentImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  return invalidateRosterAfter(
    request<StudentImportResult>("/students/import", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    })
  );
}

export function listStudents(
  token: string,
  filters?: { keyword?: string; className?: string }
): Promise<Student[]> {
  const params = new URLSearchParams();
  if (filters?.keyword) {
    params.set("keyword", filters.keyword);
  }
  if (filters?.className) {
    params.set("className", filters.className);
  }
  const query = params.toString();
  return request<Student[]>(`/students${query ? `?${query}` : ""}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function listStudentClasses(token: string): Promise<string[]> {
  return request<string[]>("/students/classes", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function exportStudentsFile(
  token: string,
  filters?: { keyword?: string; className?: string }
): Promise<void> {
  const params = new URLSearchParams();
  if (filters?.keyword) {
    params.set("keyword", filters.keyword);
  }
  if (filters?.className) {
    params.set("className", filters.className);
  }
  const query = params.toString();

  const response = await fetch(`${BASE_URL}/students/export${query ? `?${query}` : ""}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    let message = "导出失败";
    try {
      const body = (await response.json()) as ApiResponse<unknown>;
      message = body.message || message;
    } catch {
      // 非 JSON 响应时使用默认错误提示
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "students-export.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 不能在 click() 后立刻 revoke：Firefox / Safari 会在下载真正开始前
  // 就丢掉 blob，表现是「点了导出，什么都没发生」。延后回收。
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function addStudent(
  token: string,
  payload: {
    name: string;
    studentNo: string;
    className?: string;
    initialPoints?: number;
  }
): Promise<Student> {
  return invalidateRosterAfter(
    request<Student>("/students", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
  );
}

export function updateStudent(
  token: string,
  studentId: number,
  payload: {
    name: string;
    studentNo: string;
    className?: string;
    totalPoints?: number;
  }
): Promise<Student> {
  return invalidateRosterAfter(
    request<Student>(`/students/${studentId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
  );
}

export function deleteStudent(token: string, studentId: number): Promise<void> {
  return invalidateRosterAfter(
    request<void>(`/students/${studentId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
  );
}

export function adjustStudentPoints(
  token: string,
  studentId: number,
  payload: { amount: number; reason?: string; requestId?: string }
): Promise<StudentPointsResponse> {
  return request<StudentPointsResponse>(`/students/${studentId}/points`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

/**
 * 取一张「进入某个游戏」的短期访问票据。
 *
 * 游戏 iframe 带不了 Authorization 头，原先只能把主登录 token 拼进 URL；
 * 现在改成先换一张只对这一个游戏、这一个版本有效、8 小时过期的票据。
 * 票据即使泄漏，也拿不到任何接口权限。
 */
export function createPlayTicket(
  token: string,
  gameCode: string,
  version: string
): Promise<{ ticket: string; expiresAt: string }> {
  return request<{ ticket: string; expiresAt: string }>(
    `/play-ticket/${encodeURIComponent(gameCode)}/${encodeURIComponent(version)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
}

export function getStudentPoints(
  token: string,
  studentId: number
): Promise<StudentPointsDetail> {
  return request<StudentPointsDetail>(`/students/${studentId}/points`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function listStoreGames(token: string): Promise<StoreGame[]> {
  return request<StoreGame[]>("/store/games", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function listInstalledGames(token: string): Promise<InstalledGame[]> {
  return request<InstalledGame[]>("/me/games", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function installGame(token: string, gameCode: string): Promise<StoreGame> {
  return request<StoreGame>(`/store/games/${gameCode}/install`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function redeemCode(token: string, code: string): Promise<RedeemResult> {
  return request<RedeemResult>("/store/redeem", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ code })
  });
}

export function installDownloadedPackage(
  token: string,
  gameCode: string,
  zip: Blob,
  fileName: string
): Promise<StoreGame> {
  const form = new FormData();
  form.append("file", zip, fileName);
  return request<StoreGame>(
    `/store/games/${encodeURIComponent(gameCode)}/package-install`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form
    }
  );
}

export function importGamePackageZip(
  token: string,
  file: File
): Promise<StoreGame> {
  const form = new FormData();
  form.append("file", file);
  return request<StoreGame>("/store/games/import-package", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });
}

export function uninstallGame(token: string, gameCode: string): Promise<void> {
  return request<void>(`/store/games/${gameCode}/uninstall`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function getInstalledManifest(
  token: string,
  gameCode: string
): Promise<GameManifest> {
  const response = await fetch(
    `${BASE_URL}/store/games/${encodeURIComponent(gameCode)}/manifest`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    let message = "读取游戏清单失败";
    try {
      const body = (await response.json()) as ApiResponse<unknown>;
      message = body.message || message;
    } catch {
      // 非 JSON 响应时使用默认错误提示
    }
    throw new Error(message);
  }

  return (await response.json()) as GameManifest;
}

export function submitGameScore(
  token: string,
  gameCode: string,
  payload: {
    studentId: number;
    score: number;
    roundId: string;
  }
): Promise<GameScoreResult> {
  return request<GameScoreResult>(
    `/games/${encodeURIComponent(gameCode)}/scores`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    }
  );
}

export function listClasses(token: string): Promise<ClassSummary[]> {
  return request<ClassSummary[]>("/classes", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function setClassMonitor(
  token: string,
  className: string,
  monitorName: string
): Promise<ClassSummary> {
  return request<ClassSummary>("/classes/monitor", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ className, monitorName })
  });
}

export function deleteClass(token: string, className: string): Promise<void> {
  return invalidateRosterAfter(
    request<void>(`/classes?className=${encodeURIComponent(className)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
  );
}

export function cloudLoginLocal(payload: {
  username: string;
  password: string;
}): Promise<AuthResult> {
  return request<AuthResult>(
    "/auth/local/login",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    CLOUD_BASE_URL
  );
}

export function cloudRegisterLocal(payload: {
  username: string;
  password: string;
  nickname?: string;
}): Promise<AuthResult> {
  return request<AuthResult>(
    "/auth/local/register",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    CLOUD_BASE_URL
  );
}

export function cloudListStoreGames(token: string): Promise<StoreGame[]> {
  return request<StoreGame[]>(
    "/store/games",
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    CLOUD_BASE_URL
  );
}

export function cloudRedeemCode(
  token: string,
  code: string
): Promise<RedeemResult> {
  return request<RedeemResult>(
    "/store/redeem",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ code })
    },
    CLOUD_BASE_URL
  );
}

export async function cloudDownloadPackage(
  token: string,
  gameCode: string
): Promise<Blob> {
  const response = await fetch(
    `${CLOUD_BASE_URL}/store/games/${encodeURIComponent(gameCode)}/package`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    let message = "下载插件包失败";
    try {
      const body = (await response.json()) as ApiResponse<unknown>;
      message = body.message || message;
    } catch {
      // 非 JSON 响应时使用默认错误提示
    }
    throw new Error(message);
  }

  return response.blob();
}

export function getPlatformSettings(token: string): Promise<PlatformSettings> {
  return request<PlatformSettings>("/settings", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function updatePluginInstallDir(
  token: string,
  path: string
): Promise<PlatformSettings> {
  return request<PlatformSettings>("/settings/plugin-dir", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ path })
  });
}

export async function checkCloudHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${CLOUD_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function updateCloudBaseUrl(token: string, url: string): Promise<PlatformSettings> {
  return request<PlatformSettings>("/settings/cloud-url", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ url })
  });
}
