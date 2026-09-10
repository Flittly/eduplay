import { useEffect, useState } from "react";
import {
  checkCloudHealth,
  getPlatformSettings,
  updateCloudBaseUrl,
  updatePluginInstallDir
} from "../api";
import { clearSavedCredentials } from "../rememberCredentials";
import { useTranslation } from "../i18n";
import { PLATFORM_COPYRIGHT, PLATFORM_DEVELOPER } from "../components/InfoDialog";
import type { PlatformSettings } from "../types";

interface SettingsPageProps {
  token: string;
  userRole: string;
}

type CloudStatus = "checking" | "online" | "offline";

export default function SettingsPage({ token, userRole }: SettingsPageProps) {
  const { lang, setLang, t } = useTranslation();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pluginDirInput, setPluginDirInput] = useState("");
  const [savingDir, setSavingDir] = useState(false);
  const [cloudUrlInput, setCloudUrlInput] = useState("");
  const [savingCloudUrl, setSavingCloudUrl] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("checking");

  const isTeacher = userRole === "TEACHER" || userRole === "SUPER_ADMIN";

  useEffect(() => {
    getPlatformSettings(token)
      .then((result) => {
        setSettings(result);
        setPluginDirInput(result.pluginInstallDir);
        setCloudUrlInput(result.cloudBaseUrl);
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : String(err))
      );
    checkCloudHealth().then((ok) => setCloudStatus(ok ? "online" : "offline"));
  }, [token]);

  async function handleSaveDir() {
    if (!pluginDirInput.trim() || savingDir) {
      return;
    }
    setSavingDir(true);
    setNotice("");
    setError("");
    try {
      const result = await updatePluginInstallDir(token, pluginDirInput.trim());
      setSettings(result);
      setPluginDirInput(result.pluginInstallDir);
      setNotice(t("settings.plugins.done"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.message.failed"));
    } finally {
      setSavingDir(false);
    }
  }

  async function handleSaveCloudUrl() {
    if (!cloudUrlInput.trim() || savingCloudUrl) {
      return;
    }
    setSavingCloudUrl(true);
    setNotice("");
    setError("");
    try {
      const result = await updateCloudBaseUrl(token, cloudUrlInput.trim());
      setSettings(result);
      setCloudUrlInput(result.cloudBaseUrl);
      setNotice(t("settings.cloud.saved"));
      // 重新检测云端可达性
      setCloudStatus("checking");
      checkCloudHealth().then((ok) => setCloudStatus(ok ? "online" : "offline"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.message.failed"));
    } finally {
      setSavingCloudUrl(false);
    }
  }

  function handleClearCredentials() {
    clearSavedCredentials("local");
    clearSavedCredentials("cloud");
    setNotice(t("settings.data.cleared"));
  }

  return (
    <div className="page-content settings-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">{t("settings.kicker")}</p>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
      </header>

      {loadError && <div className="error">{loadError}</div>}
      {notice && <div className="success-tip">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {/* 通用 */}
      <section className="settings-card">
        <h2>{t("settings.section.general")}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t("settings.language")}</strong>
            <span>{t("settings.language.hint")}</span>
          </div>
          <div className="language-switch">
            <button
              type="button"
              className={lang === "zh" ? "active" : ""}
              onClick={() => setLang("zh")}
            >
              中文
            </button>
            <button
              type="button"
              className={lang === "en" ? "active" : ""}
              onClick={() => setLang("en")}
            >
              English
            </button>
          </div>
        </div>
      </section>

      {/* 游戏安装位置（仅教师） */}
      {isTeacher && (
        <section className="settings-card">
          <h2>{t("settings.section.plugins")}</h2>
          <div className="settings-row settings-row-column">
            <div className="settings-row-label">
              <strong>{t("settings.plugins.current")}</strong>
              <span>{t("settings.plugins.hint")}</span>
            </div>
            <input
              type="text"
              value={pluginDirInput}
              onChange={(event) => setPluginDirInput(event.target.value)}
              placeholder="D:/EduPlayGames"
              spellCheck={false}
            />
            <button
              className="primary"
              type="button"
              disabled={savingDir ||
                !settings ||
                pluginDirInput.trim() === settings.pluginInstallDir}
              onClick={() => void handleSaveDir()}
            >
              {savingDir ? t("settings.plugins.saving") : t("settings.plugins.save")}
            </button>
          </div>
        </section>
      )}

      {/* 云端服务（仅教师） */}
      {isTeacher && (
        <section className="settings-card">
          <h2>{t("settings.section.cloud")}</h2>
          <div className="settings-row settings-row-column">
            <div className="settings-row-label">
              <strong>{t("settings.cloud.url")}</strong>
              <span>{t("settings.cloud.hint")}</span>
            </div>
            <input
              type="text"
              value={cloudUrlInput}
              onChange={(event) => setCloudUrlInput(event.target.value)}
              placeholder="http://192.168.1.100:17070"
              spellCheck={false}
            />
            <button
              className="primary"
              type="button"
              disabled={savingCloudUrl ||
                !settings ||
                cloudUrlInput.trim() === settings.cloudBaseUrl}
              onClick={() => void handleSaveCloudUrl()}
            >
              {savingCloudUrl ? t("settings.plugins.saving") : t("settings.cloud.save")}
            </button>
          </div>
        </section>
      )}

      {/* 平台信息 */}
      <section className="settings-card">
        <h2>{t("settings.section.info")}</h2>
        <ul className="settings-info-list">
          <li>
            <span>{t("settings.info.version")}</span>
            <strong>v{settings?.version ?? "…"}</strong>
          </li>
          <li>
            <span>{t("settings.info.port")}</span>
            <strong>{settings?.serverPort ?? "…"}</strong>
          </li>
          <li>
            <span>{t("settings.info.db")}</span>
            <strong className="settings-path">{settings?.databasePath ?? "…"}</strong>
          </li>
          <li>
            <span>{t("settings.info.cloud")}</span>
            <strong>
              <span className={`status-dot status-${cloudStatus}`} />
              {cloudStatus === "checking"
                ? t("settings.cloud.checking")
                : cloudStatus === "online"
                  ? t("settings.cloud.online")
                  : t("settings.cloud.offline")}
            </strong>
          </li>
        </ul>
      </section>

      {/* 数据与隐私 */}
      <section className="settings-card">
        <h2>{t("settings.section.data")}</h2>
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>{t("settings.data.clear")}</strong>
            <span>{t("settings.data.hint")}</span>
          </div>
          <button className="secondary" type="button" onClick={handleClearCredentials}>
            {t("settings.data.clear")}
          </button>
        </div>
      </section>

      {/* 关于 */}
      <section className="settings-card">
        <h2>{t("settings.section.about")}</h2>
        <ul className="settings-info-list">
          <li>
            <span>EduPlay</span>
            <strong>地理教育游戏平台 · Geography Education Game Platform</strong>
          </li>
          <li>
            <span>Developer</span>
            <strong>{PLATFORM_DEVELOPER}</strong>
          </li>
          <li>
            <span>©</span>
            <strong>{PLATFORM_COPYRIGHT}</strong>
          </li>
        </ul>
      </section>
    </div>
  );
}
