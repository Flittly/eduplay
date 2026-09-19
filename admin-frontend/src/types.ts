export interface AdminUser {
  id: number;
  username: string;
  nickname: string;
  userType: string;
  role: string;
  status: string;
}

export interface AuthResult {
  token: string;
  user: AdminUser;
}

export interface AdminStats {
  teacherTotal: number;
  teacherActive: number;
  teacherDisabled: number;
  studentTotal: number;
  gameTotal: number;
  codeTotal: number;
  codeUsed: number;
  codeUnused: number;
}

export interface Teacher {
  id: number;
  username: string;
  nickname: string;
  status: string;
  studentCount: number;
  createdAt: string | null;
}

export interface ActivationCode {
  id: number;
  code: string;
  gameCode: string;
  status: string;
  usedBy: string | null;
  usedAt: string | null;
  createdAt: string | null;
}

export interface AdminGame {
  id: number;
  gameCode: string;
  name: string;
  description: string | null;
  priceCents: number;
  status: string;
  version: string;
  entitlementCount: number;
  installCount: number;
  packageVersionCount: number;
}

export interface AdminTag {
  id: number;
  category: string;
  code: string;
  name: string;
  status: string;
  sortOrder: number;
}
