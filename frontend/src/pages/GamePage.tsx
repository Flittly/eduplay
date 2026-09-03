import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { completeSession, getGame, startSession } from "../api";
import ProvincePuzzle from "../games/ProvincePuzzle";
import type { Game, GameResult, User } from "../types";

interface GamePageProps {
  user: User;
}

export default function GamePage({ user }: GamePageProps) {
  const { gameCode = "" } = useParams();
  const [game, setGame] = useState<Game | null>(null);
  const [sessionNo, setSessionNo] = useState("");
  const [result, setResult] = useState<GameResult | null>(null);
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const gameDetail = await getGame(gameCode);
        if (cancelled) {
          return;
        }
        setGame(gameDetail);

        if (user && !startedRef.current) {
          startedRef.current = true;
          const session = await startSession(gameCode, user.id);
          if (!cancelled) {
            setSessionNo(session.sessionNo);
          }
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
  }, [gameCode, user]);

  async function handleComplete(payload: {
    score: number;
    correctCount: number;
    totalCount: number;
  }) {
    if (!user) {
      setError("请先返回首页并进入游客试玩");
      return;
    }
    if (!sessionNo) {
      setError("游戏会话尚未准备好");
      return;
    }

    setError("");
    try {
      const gameResult = await completeSession(gameCode, sessionNo, {
        userId: user.id,
        ...payload
      });
      setResult(gameResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交游戏成绩失败");
    }
  }

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
          <p>本次获得积分：{result.pointsAwarded}</p>
          <p>当前总积分：{result.balance}</p>
          <Link className="primary button-link" to="/">
            返回游戏中心
          </Link>
        </section>
      ) : (
        <ProvincePuzzle onComplete={handleComplete} />
      )}
    </div>
  );
}
