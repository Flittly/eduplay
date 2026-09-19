import { useState } from "react";
import { adminLogin } from "../api";
import type { AdminUser } from "../types";

interface LoginPageProps {
  onLogin: (token: string, user: AdminUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const result = await adminLogin({ username, password });
      onLogin(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-brand">
        <div className="logo-mark large">E</div>
        <h1>EduPlay Admin</h1>
        <p>管理教师、游戏与激活码</p>
      </div>

      <div className="login-card">
        <p className="eyebrow">ADMIN</p>
        <h2>管理员登录</h2>
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button
          className="neu-button accent full"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "登录中..." : "登录"}
        </button>
      </div>
    </div>
  );
}
