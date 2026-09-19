import {
  Bell,
  Boxes,
  LayoutDashboard,
  LogOut,
  Search,
  Tags,
  Ticket,
  Users
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import type { AdminUser } from "../types";

const navItems = [
  { to: "/dashboard", label: "数据概览", icon: LayoutDashboard },
  { to: "/teachers", label: "教师管理", icon: Users },
  { to: "/games", label: "游戏管理", icon: Boxes },
  { to: "/tags", label: "标签管理", icon: Tags },
  { to: "/codes", label: "兑换码", icon: Ticket }
];

interface AdminLayoutProps {
  user: AdminUser;
  onLogout: () => void;
}

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <span className="logo-mark">E</span>
          <div>
            <strong>EduPlay</strong>
            <small>Admin</small>
          </div>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `admin-nav-link ${isActive ? "active" : ""}`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="admin-user">
          <strong>{user.nickname}</strong>
          <span>{user.username}</span>
          <button className="logout-button" type="button" onClick={onLogout}>
            <LogOut size={17} />
            退出登录
          </button>
        </div>
      </aside>

      <div className="dashboard-body">
        <header className="topbar">
          <label className="top-search">
            <Search size={16} />
            <input placeholder="搜索教师、游戏或兑换码" />
          </label>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="通知">
              <Bell size={18} />
            </button>
            <div className="topbar-user">
              <div className="user-avatar">A</div>
              <div>
                <strong>{user.nickname}</strong>
                <span>{user.username}</span>
              </div>
            </div>
          </div>
        </header>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
