import { Download, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  adminCodes,
  adminDownloadCodes,
  adminGenerateCodes
} from "../api";
import type { ActivationCode } from "../types";

interface CodesPageProps {
  token: string;
}

export default function CodesPage({ token }: CodesPageProps) {
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [gameCode, setGameCode] = useState("province_puzzle");
  const [count, setCount] = useState(10);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setCodes(await adminCodes(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载兑换码失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function generate() {
    setError("");
    try {
      await adminGenerateCodes(token, gameCode, count);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    }
  }

  async function exportCodes() {
    setError("");
    try {
      await adminDownloadCodes(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">ACTIVATION</p>
          <h1>兑换码</h1>
        </div>
        <button className="neu-button" onClick={exportCodes}>
          <Download size={17} />
          导出 CSV
        </button>
      </header>

      {error && <p className="login-error">{error}</p>}

      <section className="neu-card">
        <h2>批量生成</h2>
        <div className="toolbar">
          <label>
            游戏代码
            <input
              value={gameCode}
              onChange={(event) => setGameCode(event.target.value)}
            />
          </label>
          <label>
            数量
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <button className="neu-button accent" onClick={generate}>
            <Plus size={17} />
            生成
          </button>
        </div>
      </section>

      <section className="neu-card">
        {loading ? (
          <p>正在加载兑换码...</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>兑换码</th>
                  <th>游戏代码</th>
                  <th>状态</th>
                  <th>使用人</th>
                  <th>生成时间</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((item) => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.gameCode}</td>
                    <td>{item.status === "USED" ? "已使用" : "未使用"}</td>
                    <td>{item.usedBy ?? "-"}</td>
                    <td>{item.createdAt ?? "-"}</td>
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
