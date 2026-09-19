import { Download, Plus, Tags, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  adminCreateGame,
  adminExportTaggedPackage,
  adminGameTags,
  adminGames,
  adminSetGameTags,
  adminTags,
  adminUpdateGameStatus,
  adminUploadGamePackage
} from "../api";
import type { AdminGame, AdminTag } from "../types";

interface GamesPageProps {
  token: string;
}

export default function GamesPage({ token }: GamesPageProps) {
  const [games, setGames] = useState<AdminGame[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<AdminGame | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tagTarget, setTagTarget] = useState<AdminGame | null>(null);
  const [allTags, setAllTags] = useState<AdminTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagSaving, setTagSaving] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState(990);

  async function load() {
    setLoading(true);
    try {
      setGames(await adminGames(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载游戏失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function createGame() {
    setError("");
    try {
      await adminCreateGame(token, {
        gameCode: newCode,
        name: newName,
        description: newDescription,
        priceCents: newPrice
      });
      setShowCreate(false);
      setNewCode("");
      setNewName("");
      setNewDescription("");
      setNewPrice(990);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建游戏失败");
    }
  }

  async function toggleStatus(game: AdminGame) {
    setError("");
    try {
      await adminUpdateGameStatus(
        token,
        game.id,
        game.status === "ACTIVE" ? "DRAFT" : "ACTIVE"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新状态失败");
    }
  }

  async function exportTagged(game: AdminGame) {
    setError("");
    try {
      await adminExportTaggedPackage(token, game.gameCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function uploadPackage() {
    if (!uploadTarget || !file) {
      return;
    }
    setError("");
    try {
      await adminUploadGamePackage(token, uploadTarget.gameCode, file);
      setUploadTarget(null);
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    }
  }

  async function openTags(game: AdminGame) {
    setError("");
    try {
      const [tags, current] = await Promise.all([
        adminTags(token),
        adminGameTags(token, game.id)
      ]);
      setAllTags(tags);
      setSelectedTagIds(current.map((tag) => tag.id));
      setTagTarget(game);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载标签失败");
    }
  }

  async function saveTags() {
    if (!tagTarget) {
      return;
    }
    setTagSaving(true);
    setError("");
    try {
      await adminSetGameTags(token, tagTarget.id, selectedTagIds);
      setTagTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存标签失败");
    } finally {
      setTagSaving(false);
    }
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
  }

  const tagGroups = allTags.reduce<Record<string, AdminTag[]>>((groups, tag) => {
    const list = groups[tag.category] ?? [];
    list.push(tag);
    groups[tag.category] = list;
    return groups;
  }, {});

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">GAMES</p>
          <h1>游戏管理</h1>
        </div>
        <button className="neu-button" onClick={() => setShowCreate(true)}>
          <Plus size={17} />
          新建游戏
        </button>
      </header>

      {error && <p className="login-error">{error}</p>}

      {loading ? (
        <p>正在加载游戏...</p>
      ) : (
        <section className="neu-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>游戏</th>
                  <th>代码</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>已拥有</th>
                  <th>已安装</th>
                  <th>版本数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.id}>
                    <td>{game.name}</td>
                    <td>{game.gameCode}</td>
                    <td>{game.version}</td>
                    <td>{game.status === "ACTIVE" ? "已上架" : "草稿"}</td>
                    <td>{game.entitlementCount}</td>
                    <td>{game.installCount}</td>
                    <td>{game.packageVersionCount}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="neu-button small"
                          onClick={() => toggleStatus(game)}
                        >
                          {game.status === "ACTIVE" ? "下架" : "上架"}
                        </button>
                        <button
                          className="neu-button small"
                          onClick={() => setUploadTarget(game)}
                        >
                          <Upload size={14} />
                          上传插件包
                        </button>
                        <button
                          className="neu-button small"
                          onClick={() => openTags(game)}
                        >
                          <Tags size={14} />
                          标签
                        </button>
                        <button
                          className="neu-button small"
                          onClick={() => exportTagged(game)}
                        >
                          <Download size={14} />
                          导出zip
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showCreate && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>新建游戏</h2>
            <label>
              游戏代码
              <input
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
                placeholder="province_puzzle"
              />
            </label>
            <label>
              游戏名称
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="行政区拼图"
              />
            </label>
            <label>
              描述
              <input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </label>
            <label>
              价格（分）
              <input
                type="number"
                value={newPrice}
                onChange={(event) => setNewPrice(Number(event.target.value))}
              />
            </label>
            <button className="neu-button accent" onClick={createGame}>
              创建
            </button>
            <button className="neu-button" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {uploadTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>上传 {uploadTarget.name} 插件包</h2>
            <p>插件包必须是包含 manifest.json 的 zip 文件。</p>
            <label>
              zip 文件
              <input
                type="file"
                accept=".zip"
                onChange={(event) =>
                  setFile(event.target.files?.[0] ?? null)
                }
              />
            </label>
            <button
              className="neu-button accent"
              disabled={!file}
              onClick={uploadPackage}
            >
              上传
            </button>
            <button
              className="neu-button"
              onClick={() => {
                setUploadTarget(null);
                setFile(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {tagTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>设置 {tagTarget.name} 的标签</h2>
            <div className="tag-groups">
              {Object.entries(tagGroups).map(([category, tags]) => (
                <div key={category} className="tag-group">
                  <strong>{category}</strong>
                  <div className="tag-options">
                    {tags.map((tag) => (
                      <label key={tag.id} className="tag-check">
                        <input
                          type="checkbox"
                          checked={selectedTagIds.includes(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                        />
                        {tag.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="neu-button accent"
              disabled={tagSaving}
              onClick={saveTags}
            >
              {tagSaving ? "保存中..." : "保存"}
            </button>
            <button
              className="neu-button"
              onClick={() => setTagTarget(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
