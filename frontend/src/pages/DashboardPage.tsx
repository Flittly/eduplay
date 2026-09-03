import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPoints, listGames } from "../api";
import type { Game, User } from "../types";

interface DashboardPageProps {
  user: User;
}

export default function DashboardPage({ user }: DashboardPageProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const gameList = await listGames();
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
  }, []);

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
        {games.map((game) => (
          <Link
            key={game.gameCode}
            className="game-card"
            to={`/game/${game.gameCode}`}
          >
            <div className="game-card-icon">🗺️</div>
            <h3>{game.name}</h3>
            <p>{game.description}</p>
            <span className="version">v{game.version}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
