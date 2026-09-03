import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listInstalledGames } from "../api";
import ProvincePuzzle from "../games/ProvincePuzzle";
import type { InstalledGame } from "../types";

interface GamePageProps {
  token: string;
}

interface LocalGameResult {
  score: number;
  correctCount: number;
  totalCount: number;
}

export default function GamePage({ token }: GamePageProps) {
  const { gameCode = "" } = useParams();
  const [game, setGame] = useState<InstalledGame | null>(null);
  const [result, setResult] = useState<LocalGameResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const installedGames = await listInstalledGames(token);
        const installedGame = installedGames.find(
          (item) => item.gameCode === gameCode
        );
        if (!cancelled) {
          setGame(installedGame ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载游戏失败");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [gameCode, token]);

  if (!game) {
    return (
      <div className="page-content">
        <p>{error || "正在加载游戏..."}</p>
        <Link to="/">返回游戏中心</Link>
      </div>
    );
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <Link to="/">返回游戏中心</Link>
        <h1>{game.name}</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {result ? (
        <section className="result-card">
          <h2>游戏完成</h2>
          <p>得分：{result.score}</p>
          <p>
            正确题数：{result.correctCount} / {result.totalCount}
          </p>
          <Link className="primary button-link" to="/">
            返回游戏中心
          </Link>
        </section>
      ) : (
        <ProvincePuzzle onComplete={setResult} />
      )}
    </div>
  );
}
