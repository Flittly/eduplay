import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createGuest, getPoints, listGames } from "../api";
import type { Game, PointsSummary, User } from "../types";

interface HomeProps {
  user: User | null;
  setUser: (user: User | null) => void;
}

export default function Home({ user, setUser }: HomeProps) {
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
    if (!user) {
      setPoints(0);
      return;
    }

    getPoints(user.id)
      .then((summary: PointsSummary) => setPoints(summary.balance))
      .catch(() => setPoints(0));
  }, [user]);

  async function handleGuestLogin() {
    setError("");
    try {
      const guest = await createGuest();
      setUser(guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建游客账号失败");
    }
  }

  if (loading) {
    return <main className="page">正在加载游戏中心...</main>;
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>EduPlay</h1>
        <div className="user-box">
          {user ? (
            <>
              <span>{user.nickname}</span>
              <span className="points">积分：{points}</span>
            </>
          ) : (
            <button className="primary" onClick={handleGuestLogin}>
              游客试玩
            </button>
          )}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="hero">
        <h2>地理教育游戏平台</h2>
        <p>以游戏化方式认识行政区、省会与地理故事。</p>
      </section>

      <section>
        <h2>游戏中心</h2>
        <div className="game-grid">
          {games.map((game) => (
            <Link
              key={game.gameCode}
              className="game-card"
              to={`/game/${game.gameCode}`}
            >
              <h3>{game.name}</h3>
              <p>{game.description}</p>
              <span className="version">v{game.version}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

