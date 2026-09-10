import { useState } from "react";
import { updateProfile } from "../api";
import type { User } from "../types";

interface ProfileDialogProps {
  user: User;
  token: string;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

export default function ProfileDialog({
  user,
  token,
  onClose,
  onUpdated
}: ProfileDialogProps) {
  const [nickname, setNickname] = useState(user.nickname);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [gender, setGender] = useState(user.gender ?? "");
  const [birthday, setBirthday] = useState(user.birthday ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedTip, setSavedTip] = useState(false);

  async function handleSave() {
    setError("");
    setSavedTip(false);
    if (!nickname.trim()) {
      setError("昵称不能为空");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile(token, {
        nickname: nickname.trim(),
        phone,
        email,
        gender,
        birthday
      });
      onUpdated(updated);
      setSavedTip(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal-card profile-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="info-modal-head">
          <div>
            <p className="page-kicker">个人信息</p>
            <h2>{user.username}</h2>
          </div>
          <button
            className="info-modal-close"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="profile-form">
          <label>
            用户名
            <input value={user.username} disabled />
          </label>

          <label>
            昵称
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="例如：王老师"
            />
          </label>

          <div className="profile-grid">
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

          {error && <div className="error">{error}</div>}
          {savedTip && (
            <div className="success-tip">已保存，左下角昵称已同步更新。</div>
          )}

          <div className="profile-actions">
            <button
              className="primary"
              type="button"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
