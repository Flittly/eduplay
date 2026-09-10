import { useState } from "react";
import {
  Info,
  LogOut,
  Map,
  School,
  Settings,
  ShoppingBag,
  UserCog,
  Users,
  Wrench
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import InfoDialog from "../components/InfoDialog";
import ProfileDialog from "../components/ProfileDialog";
import { useTranslation } from "../i18n";
import type { User } from "../types";

interface AppLayoutProps {
  user: User;
  token: string;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
}

export default function AppLayout({
  user,
  token,
  onLogout,
  onUserUpdated
}: AppLayoutProps) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { t } = useTranslation();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `side-link ${isActive ? "active" : ""}`;

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
            <NavLink to="/" className={navLinkClass}>
              <Map size={18} />
              <span>{t("nav.games")}</span>
            </NavLink>

            <NavLink to="/store" className={navLinkClass}>
              <ShoppingBag size={18} />
              <span>{t("nav.store")}</span>
            </NavLink>

            {user.role === "TEACHER" && (
              <NavLink to="/teacher/points" className={navLinkClass}>
                <Users size={18} />
                <span>{t("nav.points")}</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink to="/teacher/students" className={navLinkClass}>
                <UserCog size={18} />
                <span>{t("nav.students")}</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink to="/teacher/classes" className={navLinkClass}>
                <School size={18} />
                <span>{t("nav.classes")}</span>
              </NavLink>
            )}

            {user.role === "TEACHER" && (
              <NavLink to="/tools" className={navLinkClass}>
                <Wrench size={18} />
                <span>{t("nav.tools")}</span>
              </NavLink>
            )}

            <NavLink to="/settings" className={navLinkClass}>
              <Settings size={18} />
              <span>{t("nav.settings")}</span>
            </NavLink>
          </nav>

          <div className="sidebar-footer">
            <button
              className="sidebar-user"
              type="button"
              title="点击查看和编辑个人资料"
              onClick={() => setProfileOpen(true)}
            >
              <div className="avatar">{user.nickname.slice(0, 1)}</div>
              <div className="user-meta">
                <strong>{user.nickname}</strong>
                <span>
                  {user.role === "TEACHER"
                    ? t("role.teacher")
                    : t("role.student")}
                </span>
              </div>
            </button>
            <button
              className="about-platform-button"
              type="button"
              onClick={() => setAboutOpen(true)}
            >
              <Info size={16} />
              {t("nav.about")}
            </button>
            <button className="logout-button" onClick={onLogout}>
              <LogOut size={16} />
              {t("nav.logout")}
            </button>
          </div>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>

      {aboutOpen && <InfoDialog onClose={() => setAboutOpen(false)} />}

      {profileOpen && (
        <ProfileDialog
          user={user}
          token={token}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updated) => {
            onUserUpdated(updated);
            setProfileOpen(false);
          }}
        />
      )}
    </>
  );
}
