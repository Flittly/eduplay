import type { GameTag } from "../types";

export const PLATFORM_DEVELOPER = "奇偶瓜肥实验室";
export const PLATFORM_COPYRIGHT = "© 2026 EduPlay · 奇偶瓜肥实验室 版权所有";

export interface InfoGame {
  name: string;
  description?: string | null;
  version?: string | null;
  tags?: GameTag[];
}

interface InfoDialogProps {
  game?: InfoGame | null;
  onClose: () => void;
}

export default function InfoDialog({ game, onClose }: InfoDialogProps) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal-card info-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="info-modal-head">
          <div>
            <p className="page-kicker">
              {game ? "游戏介绍" : "关于平台"}
            </p>
            <h2>{game ? game.name : "EduPlay 地理教育游戏平台"}</h2>
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

        {game && (
          <section className="info-section">
            <h3>游戏介绍</h3>
            <p>{game.description?.trim() || "暂无详细介绍。"}</p>
            <dl className="info-detail">
              <div>
                <dt>开发者</dt>
                <dd>{PLATFORM_DEVELOPER}</dd>
              </div>
              {game.version ? (
                <div>
                  <dt>版本</dt>
                  <dd>{game.version}</dd>
                </div>
              ) : null}
              {game.tags && game.tags.length > 0 ? (
                <div>
                  <dt>适用标签</dt>
                  <dd>{game.tags.map((tag) => tag.name).join("、")}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        )}

        <section className="info-section">
          <h3>平台介绍</h3>
          <p>
            EduPlay 是面向中学地理课堂的互动游戏平台，由{PLATFORM_DEVELOPER}
            开发。老师可以按需安装、更新和卸载地理小游戏，在课堂上用于
            大屏演示、答题互动与学生积分激励；游戏与积分数据保存在本机，
            离线环境下也可以正常使用。
          </p>
        </section>

        <section className="info-section">
          <h3>版权说明</h3>
          <p>
            本平台及其内置游戏均由{PLATFORM_DEVELOPER}
            开发，软件、界面、文案与资源的著作权归{PLATFORM_DEVELOPER}
            所有。未经许可，请勿复制、修改、再分发或用于商业用途。
          </p>
        </section>

        <footer className="info-modal-footer">
          <span>{PLATFORM_COPYRIGHT}</span>
          <button className="primary" type="button" onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}
