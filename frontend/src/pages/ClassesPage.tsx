import { useEffect, useState } from "react";
import { deleteClass, listClasses, setClassMonitor } from "../api";
import type { ClassSummary } from "../types";

interface ClassesPageProps {
  token: string;
}

export default function ClassesPage({ token }: ClassesPageProps) {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monitorTarget, setMonitorTarget] = useState<ClassSummary | null>(null);
  const [monitorName, setMonitorName] = useState("");

  async function load() {
    setLoading(true);
    try {
      setClasses(await listClasses(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载班级失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  function openMonitor(item: ClassSummary) {
    setMonitorName(item.monitorName ?? "");
    setMonitorTarget(item);
  }

  async function saveMonitor() {
    if (!monitorTarget) {
      return;
    }
    setError("");
    try {
      await setClassMonitor(
        token,
        monitorTarget.className,
        monitorName.trim()
      );
      setMonitorTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存课代表失败");
    }
  }

  async function remove(item: ClassSummary) {
    const confirmText =
      `确定删除班级「${item.className}」吗？\n` +
      `该班级共 ${item.studentCount} 名学生，删除后本机中的学生与积分将全部清除，且不可恢复。`;
    if (!window.confirm(confirmText)) {
      return;
    }
    setError("");
    try {
      await deleteClass(token, item.className);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除班级失败");
    }
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">教学管理</p>
          <h1>班级管理</h1>
          <p>查看班级人数、课代表、平均积分与最高积分学生</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        {loading ? (
          <p>正在加载班级...</p>
        ) : classes.length === 0 ? (
          <p className="panel-empty">
            暂无班级数据，请先到「学生管理」导入或添加学生。
          </p>
        ) : (
          <table className="result-table">
            <thead>
              <tr>
                <th>班级</th>
                <th>人数</th>
                <th>课代表</th>
                <th>平均积分</th>
                <th>最高积分</th>
                <th>最高积分同学</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((item) => (
                <tr key={item.className}>
                  <td>{item.className}</td>
                  <td>{item.studentCount}</td>
                  <td>{item.monitorName ?? "-"}</td>
                  <td>{item.avgPoints}</td>
                  <td>{item.maxPoints ?? "-"}</td>
                  <td>
                    {item.topStudents.length > 0
                      ? item.topStudents.join("、")
                      : "-"}
                  </td>
                  <td>
                    <div className="class-actions">
                      <button onClick={() => openMonitor(item)}>设课代表</button>
                      <button onClick={() => remove(item)}>删除班级</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {monitorTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>设置 {monitorTarget.className} 课代表</h2>
            <label>
              课代表姓名
              <input
                value={monitorName}
                onChange={(event) => setMonitorName(event.target.value)}
                placeholder="填写学生姓名，留空表示清除"
              />
            </label>
            <button className="primary" onClick={saveMonitor}>
              保存
            </button>
            <button onClick={() => setMonitorTarget(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
