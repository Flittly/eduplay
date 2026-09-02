import type {
  ApiResponse,
  Game,
  GameResult,
  PointsSummary,
  User
} from "./types";

const BASE_URL = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
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

export function listGames(): Promise<Game[]> {
  return request<Game[]>("/games");
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

