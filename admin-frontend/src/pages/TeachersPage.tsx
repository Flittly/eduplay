import { KeyRound, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  adminResetTeacherPassword,
  adminTeachers,
  adminUpdateTeacherStatus
} from "../api";
import type { Teacher } from "../types";

interface TeachersPageProps {
  token: string;
}

export default function TeachersPage({ token }: TeachersPageProps) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetTarget, setResetTarget] = useState<Teacher | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function load() {
    setLoading(true);
    try {
      setTeachers(await adminTeachers(token, keyword));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载教师失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token, keyword]);

  async function toggleStatus(teacher: Teacher) {
    setError("");
    try {
      await adminUpdateTeacherStatus(
        token,
        teacher.id,
        teacher.status === "ACTIVE" ? "DISABLED" : "ACTIVE"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function resetPassword() {
    if (!resetTarget) {
      return;
    }
    setError("");
    try {
      await adminResetTeacherPassword(token, resetTarget.id, newPassword);
      setResetTarget(null);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置密码失败");
    }
  }

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TEACHERS</p>
          <h1>教师管理</h1>
        </div>
      </header>

      {error && <p className="login-error">{error}</p>}

      <section className="neu-card">
        <div className="toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名或用户名"
            />
          </label>
        </div>

        {loading ? (
          <p>正在加载教师...</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>用户名</th>
                  <th>学生数</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td>{teacher.nickname}</td>
                    <td>{teacher.username}</td>
                    <td>{teacher.studentCount}</td>
                    <td>{teacher.status === "ACTIVE" ? "正常" : "已禁用"}</td>
                    <td>{teacher.createdAt ?? "-"}</td>
                    <td>
                      <button
                        className="neu-button small"
                        onClick={() => toggleStatus(teacher)}
                      >
                        {teacher.status === "ACTIVE" ? "禁用" : "启用"}
                      </button>
                      <button
                        className="neu-button small"
                        onClick={() => setResetTarget(teacher)}
                      >
                        <KeyRound size={14} />
                        重置密码
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resetTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>重置 {resetTarget.nickname} 的密码</h2>
            <label>
              新密码
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少6位"
              />
            </label>
            <button className="neu-button accent" onClick={resetPassword}>
              确认重置
            </button>
            <button className="neu-button" onClick={() => setResetTarget(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
