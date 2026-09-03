import { useEffect, useState } from "react";
import {
  installGame,
  listInstalledGames,
  listStoreGames,
  redeemCode,
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
  const [busyGameCode, setBusyGameCode] = useState<string | null>(null);
  const [redeemGame, setRedeemGame] = useState<StoreGame | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

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
    setBusyGameCode(game.gameCode);
    setError("");
    try {
      await installGame(token, game.gameCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setBusyGameCode(null);
    }
  }

  async function handleUninstall(game: StoreGame) {
    if (!window.confirm(`确定卸载 ${game.name} 吗？`)) {
      return;
    }
    setBusyGameCode(game.gameCode);
    setError("");
    try {
      await uninstallGame(token, game.gameCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "卸载失败");
    } finally {
      setBusyGameCode(null);
    }
  }

  async function handleRedeem() {
    if (!redeemGame) {
      return;
    }
    setRedeeming(true);
    setError("");
    try {
      await redeemCode(token, code);
      setCode("");
      setRedeemGame(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "兑换失败");
    } finally {
      setRedeeming(false);
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
          <p>兑换激活码、安装并更新地理教学游戏</p>
        </div>
        <div className="points-card">
          <span>已安装</span>
          <strong>{installedCount}</strong>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="game-grid">
        {games.map((game) => {
          const busy = busyGameCode === game.gameCode;
          return (
            <article key={game.gameCode} className="store-card">
              <div className="game-card-icon">🗺️</div>
              <h3>{game.name}</h3>
              <p>{game.description}</p>

              <div className="store-meta">
                <span>版本：{game.version}</span>
                <span>
                  {game.owned ? "已拥有" : "未拥有"} ·{" "}
                  {game.installed ? "已安装" : "未安装"}
                </span>
              </div>

              {game.updateAvailable && game.installed ? (
                <button
                  className="primary full-button"
                  disabled={busy}
                  onClick={() => handleInstall(game)}
                >
                  {busy ? "更新中..." : `更新到 ${game.version}`}
                </button>
              ) : game.owned && !game.installed ? (
                <button
                  className="primary full-button"
                  disabled={busy}
                  onClick={() => handleInstall(game)}
                >
                  {busy ? "安装中..." : "安装"}
                </button>
              ) : game.installed ? (
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
                  onClick={() => setRedeemGame(game)}
                >
                  兑换激活码
                </button>
              )}
            </article>
          );
        })}
      </div>

      {redeemGame && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>兑换 {redeemGame.name}</h2>
            <p>请输入购买后获得的激活码</p>
            <label>
              激活码
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="PROVINCE-PUZZLE-2026"
              />
            </label>
            <button
              className="primary"
              disabled={!code.trim() || redeeming}
              onClick={handleRedeem}
            >
              {redeeming ? "兑换中..." : "确认兑换"}
            </button>
            <button onClick={() => setRedeemGame(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
