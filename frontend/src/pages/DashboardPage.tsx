import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listInstalledGames } from "../api";
import type { InstalledGame } from "../types";

interface DashboardPageProps {
  token: string;
}

export default function DashboardPage({ token }: DashboardPageProps) {
  const [games, setGames] = useState<InstalledGame[]>([]);
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
          <span>已安装</span>
          <strong>{games.length}</strong>
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
