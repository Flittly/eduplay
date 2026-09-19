import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { adminCreateTag, adminTags } from "../api";
import type { AdminTag } from "../types";

interface TagsPageProps {
  token: string;
}

const categoryNames: Record<string, string> = {
  GRADE: "年级/学段",
  TEXTBOOK: "教材",
  TOPIC: "主题/知识点",
  OTHER: "其他"
};

export default function TagsPage({ token }: TagsPageProps) {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("GRADE");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  async function load() {
    setLoading(true);
    try {
      setTags(await adminTags(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载标签失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function createTag() {
    setError("");
    try {
      await adminCreateTag(token, {
        category,
        code,
        name,
        sortOrder
      });
      setCode("");
      setName("");
      setSortOrder(0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建标签失败");
    }
  }

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TAGS</p>
          <h1>标签管理</h1>
          <p>维护年级、教材、主题等游戏标签</p>
        </div>
      </header>

      {error && <p className="login-error">{error}</p>}

      <section className="neu-card">
        <h2>新建标签</h2>
        <div className="toolbar">
          <label>
            类别
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {Object.entries(categoryNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            代码
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="GRADE_7"
            />
          </label>
          <label>
            名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="七年级"
            />
          </label>
          <label>
            排序
            <input
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value))}
            />
          </label>
          <button
            className="neu-button accent"
            disabled={!code.trim() || !name.trim()}
            onClick={createTag}
          >
            <Plus size={17} />
            创建
          </button>
        </div>
      </section>

      <section className="neu-card">
        {loading ? (
          <p>正在加载标签...</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>代码</th>
                  <th>名称</th>
                  <th>排序</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id}>
                    <td>{categoryNames[tag.category] ?? tag.category}</td>
                    <td>{tag.code}</td>
                    <td>{tag.name}</td>
                    <td>{tag.sortOrder}</td>
                    <td>{tag.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
