import { LogOut, Map, ShoppingBag, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import type { User } from "../types";

interface AppLayoutProps {
  user: User;
  onLogout: () => void;
}

export default function AppLayout({ user, onLogout }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">E</div>
          <div>
            <strong>EduPlay</strong>
            <span>地理教育游戏平台</span>
          </div>
        </div>

        <nav className="side-nav">
          <NavLink
            to="/"
            className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}
          >
            <Map size={18} />
            <span>游戏中心</span>
          </NavLink>

          <NavLink
            to="/store"
            className={({ isActive }) =>
              `side-link ${isActive ? "active" : ""}`
            }
          >
            <ShoppingBag size={18} />
            <span>游戏商城</span>
          </NavLink>

          {user.role === "TEACHER" && (
            <NavLink
              to="/teacher/students"
              className={({ isActive }) =>
                `side-link ${isActive ? "active" : ""}`
              }
            >
              <Users size={18} />
              <span>学生导入</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar">{user.nickname.slice(0, 1)}</div>
            <div className="user-meta">
              <strong>{user.nickname}</strong>
              <span>{user.role === "TEACHER" ? "教师" : "学生"}</span>
            </div>
          </div>
          <button className="logout-button" onClick={onLogout}>
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
