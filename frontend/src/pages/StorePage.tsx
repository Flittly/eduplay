import { useEffect, useState } from "react";
import {
  installGame,
  listInstalledGames,
  listStoreGames,
  uninstallGame
} from "../api";
import type { InstalledGame, StoreGame } from "../types";

interface StorePageProps {
  token: string;
}

export default function StorePage({ token }: StorePageProps) {
  const [games, setGames] = useState<StoreGame[]>([]);
  const [installedCount, setInstalledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingCode, setUpdatingCode] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [storeGames, installedGames] = await Promise.all([
        listStoreGames(token),
        listInstalledGames(token)
      ]);
      setGames(storeGames);
      setInstalledCount(installedGames.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载游戏商城失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function handleInstall(game: StoreGame) {
    setUpdatingCode(game.gameCode);
    setError("");
    try {
      await installGame(token, game.gameCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setUpdatingCode(null);
    }
  }

  async function handleUninstall(game: StoreGame) {
    if (!window.confirm(`确定卸载 ${game.name} 吗？`)) {
      return;
    }
    setUpdatingCode(game.gameCode);
    setError("");
    try {
      await uninstallGame(token, game.gameCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "卸载失败");
    } finally {
      setUpdatingCode(null);
    }
  }

  if (loading) {
    return <div className="page-content">正在加载游戏商城...</div>;
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">EduPlay Store</p>
          <h1>游戏商城</h1>
          <p>浏览、购买并安装地理教学游戏</p>
        </div>
        <div className="points-card">
          <span>已安装</span>
          <strong>{installedCount}</strong>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="game-grid">
        {games.map((game) => {
          const busy = updatingCode === game.gameCode;
          return (
            <article key={game.gameCode} className="store-card">
              <div className="game-card-icon">🗺️</div>
              <h3>{game.name}</h3>
              <p>{game.description}</p>

              <div className="store-meta">
                <span>版本：{game.version}</span>
                <span>
                  {game.installed
                    ? `已安装：${game.installedVersion}`
                    : "未安装"}
                </span>
              </div>

              {game.installed ? (
                <button
                  className="secondary full-button"
                  disabled={busy}
                  onClick={() => handleUninstall(game)}
                >
                  {busy ? "处理中..." : "卸载"}
                </button>
              ) : (
                <button
                  className="primary full-button"
                  disabled={busy}
                  onClick={() => handleInstall(game)}
                >
                  {busy ? "处理中..." : "安装"}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
