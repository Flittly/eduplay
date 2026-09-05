import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { importGamePackageZip, listInstalledGames } from "../api";
import type { InstalledGame } from "../types";

interface DashboardPageProps {
  token: string;
}

export default function DashboardPage({ token }: DashboardPageProps) {
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

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

  async function handleManualImport(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("请选择 .zip 格式的游戏插件包");
      return;
    }
    setImportBusy(true);
    setError("");
    setNotice("");
    try {
      const imported = await importGamePackageZip(token, file);
      setNotice(`已导入并安装：${imported.name}（${imported.version}）`);
      const gameList = await listInstalledGames(token);
      setGames(gameList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入游戏失败");
    } finally {
      setImportBusy(false);
      if (importFileRef.current) {
        importFileRef.current.value = "";
      }
    }
  }

  if (loading) {
    return <div className="page-content">正在加载游戏中心...</div>;
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
      {notice && <div className="success">{notice}</div>}

      <section className="manual-import-card">
        <div>
          <h2>手动导入游戏包</h2>
          <p>
            适用于无网电脑：把游戏 zip 拷到本机后直接导入，不需要登录云端商城。
          </p>
        </div>
        <input
          ref={importFileRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(event) =>
            void handleManualImport(event.target.files?.[0])
          }
        />
        <button
          className="primary"
          disabled={importBusy}
          onClick={() => importFileRef.current?.click()}
        >
          {importBusy ? "导入中..." : "选择 zip 导入"}
        </button>
      </section>

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
        {filteredGames.length === 0 ? (
          <div className="empty-state">
            <p>你还没有安装任何游戏。</p>
            <Link className="primary button-link" to="/store">
              前往游戏商城
            </Link>
          </div>
        ) : (
          filteredGames.map((game) => (
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
