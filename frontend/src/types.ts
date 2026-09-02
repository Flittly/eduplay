export interface ApiResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

export interface User {
  id: number;
  username: string;
  nickname: string;
  userType: string;
}

export interface Game {
  id: number;
  gameCode: string;
  name: string;
  description: string;
  coverUrl: string | null;
  priceCents: number;
  status: string;
  version: string;
  entry: string | null;
}

export interface GameResult {
  sessionNo: string;
  pointsAwarded: number;
  balance: number;
}

export interface PointsSummary {
  userId: number;
  balance: number;
}

