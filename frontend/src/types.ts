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

export interface StoreGame {
  id: number;
  gameCode: string;
  name: string;
  description: string;
  coverUrl: string | null;
  priceCents: number;
  version: string;
  owned: boolean;
  entitlementSource: string | null;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
}

export interface InstalledGame {
  id: number;
  gameCode: string;
  name: string;
  description: string;
  coverUrl: string | null;
  version: string;
  installedVersion: string;
  status: string;
  updateAvailable: boolean;
}

export interface RedeemResult {
  gameCode: string;
  gameName: string;
  status: string;
}

export interface GameManifest {
  gameCode: string;
  name: string;
  version: string;
  minPlatformVersion?: string;
  maxPlatformVersion?: string;
  entry: string;
  backendPlugin?: string | null;
  description?: string;
}

export interface GameScoreResult {
  id: number;
  name: string;
  studentNo: string;
  className: string | null;
  totalPoints: number;
  score: number;
  recorded: boolean;
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
