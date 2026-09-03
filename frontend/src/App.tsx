import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import GamePage from "./pages/GamePage";
import LoginPage from "./pages/LoginPage";
import StorePage from "./pages/StorePage";
import TeacherStudentsPage from "./pages/TeacherStudentsPage";
import { getCurrentUser, logout } from "./api";
import type { User } from "./types";

const USER_STORAGE_KEY = "eduplay.user";
const TOKEN_STORAGE_KEY = "eduplay.token";

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export default function App() {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [token, setToken] = useState<string | null>(readStoredToken);

  useEffect(() => {
    if (!token) {
      return;
    }

    getCurrentUser(token)
      .then((currentUser) => {
        setUser(currentUser);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
      })
      .catch(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      });
  }, [token]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  function handleAuthenticated(authToken: string, currentUser: User) {
    setToken(authToken);
    setUser(currentUser);
  }

  function handleLogout() {
    if (token) {
      void logout(token).catch(() => undefined);
    }
    setToken(null);
    setUser(null);
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage onAuthenticated={handleAuthenticated} />
          )
        }
      />

      <Route
        element={
          user && token ? (
            <AppLayout user={user} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route
          path="/"
          element={<DashboardPage user={user!} token={token ?? ""} />}
        />
        <Route path="/game/:gameCode" element={<GamePage user={user!} />} />
        <Route
          path="/store"
          element={<StorePage token={token ?? ""} />}
        />
        <Route
          path="/teacher/students"
          element={<TeacherStudentsPage user={user!} token={token} />}
        />
      </Route>
    </Routes>
  );
}
