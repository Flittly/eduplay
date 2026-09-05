import { useEffect, useState } from "react";
import {
  cloudDownloadPackage,
  cloudListStoreGames,
  cloudLoginLocal,
  cloudRedeemCode,
  cloudRegisterLocal,
  installDownloadedPackage,
  listInstalledGames,
  uninstallGame
} from "../api";
import type { InstalledGame, StoreGame, User } from "../types";

interface StorePageProps {
  token: string;
}

const CLOUD_TOKEN_KEY = "eduplay.cloud.token";
const CLOUD_USER_KEY = "eduplay.cloud.user";

function readCloudUser(): User | null {
  try {
    const raw = localStorage.getItem(CLOUD_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export default function StorePage({ token }: StorePageProps) {
  const [games, setGames] = useState<StoreGame[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyGameCode, setBusyGameCode] = useState<string | null>(null);

  const [cloudToken, setCloudToken] = useState<string | null>(
    () => localStorage.getItem(CLOUD_TOKEN_KEY)
  );
  const [cloudUser, setCloudUser] = useState<User | null>(readCloudUser);
  const [cloudMode, setCloudMode] = useState<"login" | "register">("login");
  const [cloudUsername, setCloudUsername] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudNickname, setCloudNickname] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");

  const [redeemGame, setRedeemGame] = useState<StoreGame | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  async function loadInstalled() {
    const installed = await listInstalledGames(token);
    setInstalledGames(installed);
    return installed;
  }

  async function loadStore(installed: InstalledGame[] = installedGames) {
    if (!cloudToken) {
      setGames([]);
      return;
    }
    setLoading(true);
    try {
      const cloudGames = await cloudListStoreGames(cloudToken);
      const merged = cloudGames.map((game) => {
        const local = installed.find(
          (item) => item.gameCode === game.gameCode
        );
        return {
          ...game,
          installed: Boolean(local),
          installedVersion: local?.installedVersion ?? null,
          updateAvailable: Boolean(
            local && local.installedVersion !== game.version
          )
        };
      });
      setGames(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载云端商城失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const installed = await loadInstalled();
        if (!cancelled) {
          await loadStore(installed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载商城失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, cloudToken]);

  async function handleCloudSubmit() {
    setCloudError("");
    setCloudBusy(true);
    try {
      const result =
        cloudMode === "login"
          ? await cloudLoginLocal({
              username: cloudUsername,
              password: cloudPassword
            })
          : await cloudRegisterLocal({
              username: cloudUsername,
              password: cloudPassword,
              nickname: cloudNickname || cloudUsername
            });
      setCloudToken(result.token);
      setCloudUser(result.user);
      localStorage.setItem(CLOUD_TOKEN_KEY, result.token);
      localStorage.setItem(CLOUD_USER_KEY, JSON.stringify(result.user));
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "云端账号操作失败");
    } finally {
      setCloudBusy(false);
    }
  }

  function handleCloudLogout() {
    setCloudToken(null);
    setCloudUser(null);
    localStorage.removeItem(CLOUD_TOKEN_KEY);
    localStorage.removeItem(CLOUD_USER_KEY);
    setGames([]);
    setSelectedTag("");
  }

  async function handleRedeem() {
    if (!redeemGame || !cloudToken) {
      return;
    }
    setRedeeming(true);
    setError("");
    try {
      await cloudRedeemCode(cloudToken, code);
      setCode("");
      setRedeemGame(null);
      await loadStore(await loadInstalled());
    } catch (err) {
      setError(err instanceof Error ? err.message : "兑换失败");
    } finally {
      setRedeeming(false);
    }
  }

  async function handleInstall(game: StoreGame) {
    if (!cloudToken) {
      return;
    }
    setBusyGameCode(game.gameCode);
    setError("");
    try {
      const blob = await cloudDownloadPackage(cloudToken, game.gameCode);
      await installDownloadedPackage(
        token,
        game.gameCode,
        blob,
        `${game.gameCode}-${game.version}.zip`
      );
      await loadStore(await loadInstalled());
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
      await loadStore(await loadInstalled());
    } catch (err) {
      setError(err instanceof Error ? err.message : "卸载失败");
    } finally {
      setBusyGameCode(null);
    }
  }

  if (!cloudToken || !cloudUser) {
    return (
      <div className="page-content">
        <header className="page-header">
          <div>
            <p className="page-kicker">EduPlay Cloud Store</p>
            <h1>游戏商城</h1>
            <p>商城数据来自云端服务器，学生和积分仍保存在本机</p>
          </div>
        </header>

        {error && <div className="error">{error}</div>}

        <section className="cloud-login-card">
          <h2>登录云端账号</h2>
          <p>兑换与下载游戏前，请先登录你的云端教师账号。</p>

          <div className="login-tabs">
            <button
              className={cloudMode === "login" ? "active" : ""}
              onClick={() => setCloudMode("login")}
            >
              登录
            </button>
            <button
              className={cloudMode === "register" ? "active" : ""}
              onClick={() => setCloudMode("register")}
            >
              注册
            </button>
          </div>

          <label>
            用户名
            <input
              value={cloudUsername}
              onChange={(event) => setCloudUsername(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={cloudPassword}
              onChange={(event) => setCloudPassword(event.target.value)}
            />
          </label>
          {cloudMode === "register" && (
            <label>
              昵称
              <input
                value={cloudNickname}
                onChange={(event) => setCloudNickname(event.target.value)}
                placeholder="例如：王老师"
              />
            </label>
          )}

          {cloudError && <div className="error">{cloudError}</div>}

          <button
            className="primary"
            disabled={
              cloudBusy || !cloudUsername.trim() || !cloudPassword.trim()
            }
            onClick={handleCloudSubmit}
          >
            {cloudBusy
              ? "处理中..."
              : cloudMode === "login"
                ? "登录云端账号"
                : "注册云端账号"}
          </button>
        </section>
      </div>
    );
  }

  if (loading) {
    return <div className="page-content">正在加载游戏商城...</div>;
  }

  const tagNames = Array.from(
    new Set(
      games.flatMap((game) => game.tags?.map((tag) => tag.name) ?? [])
    )
  );
  const filteredGames = selectedTag
    ? games.filter((game) =>
        game.tags?.some((tag) => tag.name === selectedTag)
      )
    : games;

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">EduPlay Cloud Store</p>
          <h1>游戏商城</h1>
          <p>云端：{cloudUser.username}</p>
        </div>
        <div className="store-actions">
          <span className="points-card">
            已安装 {installedGames.length}
          </span>
          <button className="secondary" onClick={handleCloudLogout}>
            退出云端
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {tagNames.length > 0 && (
        <div className="tag-filter-bar">
          <button
            className={selectedTag === "" ? "active" : ""}
            onClick={() => setSelectedTag("")}
          >
            全部
          </button>
          {tagNames.map((name) => (
            <button
              key={name}
              className={selectedTag === name ? "active" : ""}
              onClick={() => setSelectedTag(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="game-grid">
        {filteredGames.map((game) => {
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
                  {game.installed ? "本机已安装" : "本机未安装"}
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
                  {busy ? "下载安装中..." : "下载并安装"}
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
