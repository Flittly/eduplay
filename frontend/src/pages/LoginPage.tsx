import { useState } from "react";
import { loginLocal, registerLocal } from "../api";
import {
  clearSavedCredentials,
  loadSavedCredentials,
  saveCredentials
} from "../rememberCredentials";
import type { User } from "../types";

interface LoginPageProps {
  onAuthenticated: (token: string, user: User) => void;
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const saved = loadSavedCredentials("local");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
  const [rememberPassword, setRememberPassword] = useState(Boolean(saved));
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
              nickname,
              phone: phone || undefined,
              email: email || undefined,
              gender: gender || undefined,
              birthday: birthday || undefined
            });
      if (mode === "login") {
        if (rememberPassword) {
          saveCredentials("local", { username, password });
        } else {
          clearSavedCredentials("local");
        }
      }
      onAuthenticated(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-content">
          <img
            className="brand-logo large brand-logo-img"
            src="/eduplay-logo.png"
            alt="EduPlay"
          />
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

          {mode === "login" && (
            <label className="remember-row">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(event) =>
                  setRememberPassword(event.target.checked)
                }
              />
              <span>记住密码</span>
            </label>
          )}

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
              <div className="register-extra">
                <p className="register-extra-title">以下为选填资料</p>
                <div className="register-extra-grid">
                  <label>
                    电话
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="选填"
                    />
                  </label>
                  <label>
                    邮箱
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="选填"
                    />
                  </label>
                  <label>
                    性别
                    <select
                      value={gender}
                      onChange={(event) => setGender(event.target.value)}
                    >
                      <option value="">保密</option>
                      <option value="MALE">男</option>
                      <option value="FEMALE">女</option>
                      <option value="OTHER">其他</option>
                    </select>
                  </label>
                  <label>
                    生日
                    <input
                      type="date"
                      value={birthday}
                      onChange={(event) => setBirthday(event.target.value)}
                    />
                  </label>
                </div>
                <p className="register-extra-hint">
                  以后可随时点击左下角个人信息进行修改。
                </p>
              </div>
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
        </div>
      </section>
    </div>
  );
}
