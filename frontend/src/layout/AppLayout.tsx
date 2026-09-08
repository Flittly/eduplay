import { useState } from "react";
import {
  Info,
  LogOut,
  Map,
  School,
  ShoppingBag,
  UserCog,
  Users,
  Wrench
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import InfoDialog from "../components/InfoDialog";
import type { User } from "../types";

interface AppLayoutProps {
  user: User;
  onLogout: () => void;
}

export default function AppLayout({ user, onLogout }: AppLayoutProps) {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <img
              className="brand-logo brand-logo-img"
              src="/eduplay-logo.png"
              alt="EduPlay"
            />
            <div>
              <strong>EduPlay</strong>
              <span>地理教育游戏平台</span>
            </div>
          </div>

          <nav className="side-nav">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `side-link ${isActive ? "active" : ""}`
              }
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
                to="/teacher/points"
                className={({ isActive }) =>
                  `side-link ${isActive ? "active" : ""}`
                }
              >
                <Users size={18} />
                <span>学生积分</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink
                to="/teacher/students"
                className={({ isActive }) =>
                  `side-link ${isActive ? "active" : ""}`
                }
              >
                <UserCog size={18} />
                <span>学生管理</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink
                to="/teacher/classes"
                className={({ isActive }) =>
                  `side-link ${isActive ? "active" : ""}`
                }
              >
                <School size={18} />
                <span>班级管理</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink
                to="/tools"
                className={({ isActive }) =>
                  `side-link ${isActive ? "active" : ""}`
                }
              >
                <Wrench size={18} />
                <span>工具箱</span>
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
            <button
              className="about-platform-button"
              type="button"
              onClick={() => setAboutOpen(true)}
            >
              <Info size={16} />
              关于平台
            </button>
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

      {aboutOpen && <InfoDialog onClose={() => setAboutOpen(false)} />}
    </>
  );
}
