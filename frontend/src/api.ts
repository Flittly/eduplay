import type {
  ApiResponse,
  AuthResult,
  Game,
  GameResult,
  InstalledGame,
  PointsSummary,
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

export function createGuest(): Promise<User> {
  return request<User>("/users/guest", {
    method: "POST",
    body: JSON.stringify({ nickname: "游客" })
  });
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

export function listGames(): Promise<Game[]> {
  return request<Game[]>("/games");
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

export function getGame(gameCode: string): Promise<Game> {
  return request<Game>(`/games/${gameCode}`);
}

export function startSession(
  gameCode: string,
  userId: number
): Promise<{ sessionNo: string }> {
  return request<{ sessionNo: string }>(`/games/${gameCode}/sessions`, {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}

export function completeSession(
  gameCode: string,
  sessionNo: string,
  payload: {
    userId: number;
    score: number;
    correctCount: number;
    totalCount: number;
  }
): Promise<GameResult> {
  return request<GameResult>(
    `/games/${gameCode}/sessions/${sessionNo}/complete`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function getPoints(userId: number): Promise<PointsSummary> {
  return request<PointsSummary>(`/users/${userId}/points`);
}
