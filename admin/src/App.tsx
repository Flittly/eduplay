import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { adminLogout, adminMe } from "./api";
import AdminLayout from "./layout/AdminLayout";
import CodesPage from "./pages/CodesPage";
import DashboardPage from "./pages/DashboardPage";
import GamesPage from "./pages/GamesPage";
import LoginPage from "./pages/LoginPage";
import TagsPage from "./pages/TagsPage";
import TeachersPage from "./pages/TeachersPage";
import type { AdminUser } from "./types";

const USER_KEY = "eduplay-admin.user";
const TOKEN_KEY = "eduplay-admin.token";

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AdminUser;
    } catch {
      localStorage.removeItem(USER_KEY);
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY)
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    adminMe(token)
      .then((current) => {
        setUser(current);
        localStorage.setItem(USER_KEY, JSON.stringify(current));
      })
      .catch(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
      });
  }, [token]);

  function login(authToken: string, currentUser: AdminUser) {
    setToken(authToken);
    setUser(currentUser);
    localStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
  }

  function logout() {
    if (token) {
      void adminLogout(token).catch(() => undefined);
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to={user && token ? "/dashboard" : "/login"} replace />
        }
      />
      <Route
        path="*"
        element={
          <Navigate to={user && token ? "/dashboard" : "/login"} replace />
        }
      />
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <LoginPage onLogin={login} />
          )
        }
      />
      <Route
        element={
          user && token ? (
            <AdminLayout user={user} onLogout={logout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path="/dashboard" element={<DashboardPage token={token ?? ""} />} />
        <Route path="/teachers" element={<TeachersPage token={token ?? ""} />} />
        <Route path="/games" element={<GamesPage token={token ?? ""} />} />
        <Route path="/codes" element={<CodesPage token={token ?? ""} />} />
        <Route path="/tags" element={<TagsPage token={token ?? ""} />} />
      </Route>
    </Routes>
  );
}
