import { useState } from "react";
import { createGuest, loginLocal, registerLocal } from "../api";
import type { User } from "../types";

interface LoginPageProps {
  onAuthenticated: (token: string, user: User) => void;
  onGuest: (user: User) => void;
}

export default function LoginPage({
  onAuthenticated,
  onGuest
}: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const result =
        mode === "login"
          ? await loginLocal({ username, password })
          : await registerLocal({
              username,
              password,
              nickname
            });
      onAuthenticated(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGuest() {
    setError("");
    try {
      const guest = await createGuest();
      onGuest(guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建游客账号失败");
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-content">
          <div className="brand-logo large">E</div>
          <h1>EduPlay</h1>
          <p>可插拔地理教育游戏平台</p>
          <div className="auth-tag-list">
            <span>本地账号</span>
            <span>积分保留</span>
            <span>游戏插件</span>
          </div>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-header">
            <p className="auth-welcome">欢迎使用</p>
            <h2>{mode === "login" ? "本地登录" : "本地注册"}</h2>
          </div>

          <div className="login-tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              登录
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
            >
              注册
            </button>
          </div>

          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
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

          {mode === "register" && (
            <>
              <label>
                昵称
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="例如：王老师"
                />
              </label>
            </>
          )}

          {error && <div className="error">{error}</div>}

          <button
            className="primary auth-submit"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? "处理中..."
              : mode === "login"
                ? "登录"
                : "注册"}
          </button>

          <button className="guest-button" onClick={handleGuest}>
            游客试玩
          </button>
        </div>
      </section>
    </div>
  );
}
