import { Dices, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useRandomPick } from "../hooks/useRandomPick";

interface FloatingPickProps {
  token: string;
}

/**
 * 浮层该挂到哪个节点上。
 *
 * 页面进入原生全屏（游戏页的「全屏显示」）之后，浏览器只渲染全屏元素及其后代，
 * 挂在 `<body>` 上的浮层会整块消失 —— 而「游戏全屏中点个名」恰恰是这个浮窗
 * 最主要的使用场景。所以全屏期间要把浮层 portal 进 `document.fullscreenElement`。
 *
 * 原生全屏申请被环境拒绝时 `fullscreenElement` 仍是 null，此时游戏页走的是
 * 页面内覆盖层（`.game-frame.is-fullscreen`，z-index 200），浮层留在 body
 * 靠更高的 z-index 照样盖得住，两条路径都可用。
 */
function useOverlayRoot(): HTMLElement {
  const [root, setRoot] = useState<HTMLElement>(() =>
    document.fullscreenElement instanceof HTMLElement
      ? document.fullscreenElement
      : document.body
  );

  useEffect(() => {
    function sync() {
      const element = document.fullscreenElement;
      setRoot(element instanceof HTMLElement ? element : document.body);
    }

    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  return root;
}

/**
 * 当前是否有模态弹窗打开。
 *
 * 项目里的 `.modal-mask`（z-index 20）来自 6 处不同页面/组件，要让浮窗在
 * 它们打开时让位，从 React 侧收集这个状态就得新加一层 context 并改遍 6 个页面。
 * 这里反过来看 DOM：反正遮罩一定会进 DOM，直接观察它即可，改动只落在这一个文件里。
 */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(
    () => document.querySelector(".modal-mask") !== null
  );

  useEffect(() => {
    const sync = () => setOpen(document.querySelector(".modal-mask") !== null);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  return open;
}

/**
 * 全局浮动的「随机点名」小窗。
 *
 * 挂在 AppLayout 上，因此所有页面都能随手调出来 —— 上课玩到一半想点个名，
 * 不用离开游戏页去工具箱。它常驻不卸载，所以**一节课内点过的人会一直累积**
 * （换页面、开关面板都不会丢），「重置」按钮显式清零。
 *
 * 与 `/tools/random-pick` 整页版是两份独立状态：整页版是备课场景（要看清全班、
 * 慢慢挑班级），浮窗是课中即时场景（点一个立刻回到游戏）。两边共享同一段
 * 抽取逻辑（useRandomPick），只是不共享同一份名单进度。
 */
export default function FloatingPick({ token }: FloatingPickProps) {
  const [open, setOpen] = useState(false);
  const root = useOverlayRoot();
  const modalOpen = useModalOpen();
  const pick = useRandomPick(token);

  // 有弹窗打开时整体让位。组件本身不卸载，点名进度原样保留。
  if (modalOpen) {
    return null;
  }

  const inFullscreen = root !== document.body;
  const canPick = !pick.rolling && pick.pool.length > 0;

  return createPortal(
    <div
      className={`fp-dock${open ? " is-open" : ""}${
        inFullscreen ? " is-fullscreen" : ""
      }`}
    >
      {open && (
        <section className="fp-window" role="region" aria-label="随机点名">
          <header className="fp-head">
            <span className="fp-title">
              <Dices size={16} />
              随机点名
            </span>
            <button
              className="fp-close"
              type="button"
              aria-label="收起随机点名"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>

          <div className="fp-body">
            {pick.error && <p className="fp-error">{pick.error}</p>}

            <div className="fp-row">
              <label className="fp-field">
                班级
                <select
                  value={pick.selectedClass}
                  onChange={(event) => pick.selectClass(event.target.value)}
                >
                  <option value="ALL">全部班级</option>
                  {pick.classList.map((className) => (
                    <option key={className} value={className}>
                      {className}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fp-norepeat">
                <input
                  type="checkbox"
                  checked={pick.noRepeat}
                  onChange={(event) => {
                    if (pick.rolling) {
                      return;
                    }
                    pick.setNoRepeat(event.target.checked);
                  }}
                />
                不重复
              </label>
            </div>

            {pick.loading ? (
              <p className="fp-hint">正在加载名单…</p>
            ) : pick.students.length === 0 ? (
              <div className="fp-empty">
                <p>当前还没有学生名单，请先在学生管理中导入。</p>
                <Link
                  className="secondary button-link"
                  to="/teacher/students"
                  onClick={() => setOpen(false)}
                >
                  前往学生管理
                </Link>
              </div>
            ) : (
              <>
                <div
                  className={`fp-stage${
                    pick.rolling
                      ? " is-rolling"
                      : pick.current
                        ? " is-settled"
                        : ""
                  }`}
                >
                  <p className="fp-kicker">
                    {pick.rolling
                      ? "正在抽取…"
                      : pick.selectedClass === "ALL"
                        ? "被点到的同学是"
                        : `${pick.selectedClass} · 被点到的同学是`}
                  </p>
                  {pick.current ? (
                    <>
                      <p className="fp-name">{pick.current.name}</p>
                      <p className="fp-no">学号 {pick.current.studentNo}</p>
                    </>
                  ) : (
                    <>
                      <p className="fp-name fp-name-idle">？</p>
                      <p className="fp-no fp-no-idle">点下面的按钮开始</p>
                    </>
                  )}
                </div>

                <button
                  className="fp-go"
                  type="button"
                  disabled={!canPick}
                  onClick={pick.pick}
                >
                  {pick.rolling
                    ? "抽取中…"
                    : pick.pool.length === 0
                      ? "全班都抽过了，请重置"
                      : pick.current
                        ? "再抽一个"
                        : "开始点名"}
                </button>

                <footer className="fp-meta">
                  <span>已抽 {pick.sessionCount} 人</span>
                  {pick.noRepeat && pick.students.length > 0 && (
                    <span>
                      剩余 {pick.pool.length} / {pick.students.length}
                    </span>
                  )}
                  <button
                    className="fp-reset"
                    type="button"
                    disabled={pick.sessionCount === 0}
                    onClick={pick.resetPicked}
                  >
                    <RotateCcw size={13} />
                    重置
                  </button>
                </footer>
              </>
            )}
          </div>
        </section>
      )}

      <button
        className="fp-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={16} /> : <Dices size={16} />}
        {open ? "收起" : "随机点名"}
      </button>
    </div>,
    root
  );
}
