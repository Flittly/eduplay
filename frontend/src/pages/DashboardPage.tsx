import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPoints, listInstalledGames } from "../api";
import type { InstalledGame, User } from "../types";

interface DashboardPageProps {
  user: User;
  token: string;
}

export default function DashboardPage({ user, token }: DashboardPageProps) {
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const gameList = await listInstalledGames(token);
        if (!cancelled) {
          setGames(gameList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载游戏失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    getPoints(user.id)
      .then((summary) => setPoints(summary.balance))
      .catch(() => setPoints(0));
  }, [user.id]);

  if (loading) {
    return <div className="page-content">正在加载游戏中心...</div>;
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">EduPlay</p>
          <h1>游戏中心</h1>
          <p>选择一个地理游戏开始学习</p>
        </div>
        <div className="points-card">
          <span>当前积分</span>
          <strong>{points}</strong>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="game-grid">
        {games.length === 0 ? (
          <div className="empty-state">
            <p>你还没有安装任何游戏。</p>
            <Link className="primary button-link" to="/store">
              前往游戏商城
            </Link>
          </div>
        ) : (
          games.map((game) => (
            <Link
              key={game.gameCode}
              className="game-card"
              to={`/game/${game.gameCode}`}
            >
              <div className="game-card-icon">🗺️</div>
              <h3>{game.name}</h3>
              <p>{game.description}</p>
              <span className="version">已安装 v{game.installedVersion}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
