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
  role: string;
  studentNo: string | null;
  className: string | null;
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

export interface AuthResult {
  token: string;
  user: User;
}

export interface StudentImportFailure {
  rowNumber: number;
  name: string;
  studentNo: string;
  reason: string;
}

export interface StudentImportResult {
  total: number;
  success: number;
  failed: number;
  failures: StudentImportFailure[];
}

export interface Student {
  id: number;
  name: string;
  studentNo: string;
  className: string | null;
  totalPoints: number;
}

export interface StudentPointsLedger {
  id: number;
  changeType: string;
  amount: number;
  balanceAfter: number;
  bizType: string;
  createdAt: string;
}

export interface StudentPointsDetail {
  student: Student;
  ledger: StudentPointsLedger[];
}

export interface StudentPointsResponse {
  id: number;
  name: string;
  studentNo: string;
  className: string | null;
  totalPoints: number;
}
