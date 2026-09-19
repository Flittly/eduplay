import { Boxes, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { adminStats } from "../api";
import type { AdminStats } from "../types";

interface DashboardPageProps {
  token: string;
}

export default function DashboardPage({ token }: DashboardPageProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminStats(token)
      .then(setStats)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "加载统计失败")
      );
  }, [token]);

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>数据概览</h1>
        </div>
      </header>

      {error && <p className="login-error">{error}</p>}

      <section className="stat-grid">
        <article className="neu-card">
          <div className="stat-icon">
            <Users size={22} />
          </div>
          <span>注册教师</span>
          <strong>{stats?.teacherTotal ?? "-"}</strong>
          <small>
            正常 {stats?.teacherActive ?? "-"} / 禁用 {stats?.teacherDisabled ?? "-"}
          </small>
        </article>
        <article className="neu-card">
          <div className="stat-icon">
            <Users size={22} />
          </div>
          <span>学生总数</span>
          <strong>{stats?.studentTotal ?? "-"}</strong>
        </article>
        <article className="neu-card">
          <div className="stat-icon">
            <Boxes size={22} />
          </div>
          <span>已发布游戏</span>
          <strong>{stats?.gameTotal ?? "-"}</strong>
        </article>
        <article className="neu-card">
          <div className="stat-icon">
            <Ticket size={22} />
          </div>
          <span>兑换码</span>
          <strong>{stats?.codeTotal ?? "-"}</strong>
          <small>
            已用 {stats?.codeUsed ?? "-"} / 未用 {stats?.codeUnused ?? "-"}
          </small>
        </article>
      </section>
    </div>
  );
}
