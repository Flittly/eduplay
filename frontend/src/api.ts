import type {
  ApiResponse,
  AuthResult,
  InstalledGame,
  RedeemResult,
  Student,
  StudentPointsDetail,
  StudentPointsResponse,
  StudentImportResult,
  StoreGame,
  User
} from "./types";

const BASE_URL = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options?.headers ?? {})
    },
    ...options
  });

  const body = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !body.success) {
    throw new Error(body.message || "请求失败");
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
}): Promise<AuthResult> {
  return request<AuthResult>("/auth/local/register", {
    method: "POST",
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

export function importStudents(
  file: File,
  token: string
): Promise<StudentImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  return request<StudentImportResult>("/students/import", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });
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
  URL.revokeObjectURL(url);
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
  return request<Student>("/students", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

export function deleteStudent(token: string, studentId: number): Promise<void> {
  return request<void>(`/students/${studentId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function adjustStudentPoints(
  token: string,
  studentId: number,
  payload: { amount: number; reason?: string }
): Promise<StudentPointsResponse> {
  return request<StudentPointsResponse>(`/students/${studentId}/points`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
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

export function uninstallGame(token: string, gameCode: string): Promise<void> {
  return request<void>(`/store/games/${gameCode}/uninstall`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}
