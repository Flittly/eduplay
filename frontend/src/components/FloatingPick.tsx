import { Dices, GripVertical, RotateCcw, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useRandomPick } from "../hooks/useRandomPick";

interface FloatingPickProps {
  token: string;
}

/** 浮窗位置（视口比例，0~1）的存储键，与 eduplay.theme / eduplay.language 同一命名空间。 */
const POS_STORAGE_KEY = "eduplay.pickDockPos";

/**
 * 判定「这是拖动，不是点击」的位移阈值(px)。
 *
 * 刻意**不用**「先按住 500ms 才能拖」那套：在教室一体机上，长按的体感是「按下去没反应」，
 * 而且很容易和系统的长按菜单抢。改成「按下即待定 → 位移超过 6px 才算拖 → 没动就抬起算点击」，
 * 用户按住往旁边一拖的体感完全一样，但没有等待，也不会把「点开面板」误判成拖动。
 */
const DRAG_THRESHOLD = 6;

/** 浮窗离视口边缘至少留出的空隙(px)，免得贴着边看不出这里还有个按钮。 */
const DOCK_MARGIN = 10;

/** 浮窗锚点：其右下角到视口右 / 下边缘的距离，按视口尺寸归一化成 0~1。 */
interface DockRatio {
  right: number;
  bottom: number;
}

interface Size {
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  /** 最近一次指针位置：松手时用它算最终位置（松手事件本身可能落在把手外） */
  lastX: number;
  lastY: number;
  moved: boolean;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 读回上次拖动的位置。
 *
 * 存的是**视口比例**而不是像素：这个浮窗最要紧的场景是 U 盘便携版 —— 同一根 U 盘要在
 * 办公室笔记本（1366×768）和教室一体机（1920×1080）之间来回插。若存像素，在 1080 高的屏上
 * 把浮窗拖到偏上（bottom≈900），换到 768 的屏上会被夹回底部，老师看到的就是「它自己跑下去了」。
 * 存比例则两块屏都落在相近的相对位置。
 */
function readStoredRatio(): DockRatio | null {
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DockRatio>;
    const right = Number(parsed.right);
    const bottom = Number(parsed.bottom);
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) {
      return null;
    }
    return { right: clamp01(right), bottom: clamp01(bottom) };
  } catch {
    return null; // 存储被禁用或内容损坏：退回默认位置，不影响点名
  }
}

function storeRatio(ratio: DockRatio): void {
  try {
    window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(ratio));
  } catch {
    // 写不进去不影响本次拖动
  }
}

/**
 * 把锚点夹进视口。
 *
 * ⚠️ 必须用**浮窗当前的尺寸**来夹，而不是"一个按钮的尺寸"：面板展开时它是 320×~360，
 * 收起时只是一个胶囊。否则会出现「收着的时候拖到左上角，再一点开，面板一半跑到屏幕外」。
 * 也因此调用方要在浮窗尺寸变化时（展开/收起、进出全屏）重新夹一次。
 */
function clampAnchor(
  anchor: { right: number; bottom: number },
  size: Size,
  viewport: Size
) {
  const maxRight = Math.max(DOCK_MARGIN, viewport.width - size.width - DOCK_MARGIN);
  const maxBottom = Math.max(DOCK_MARGIN, viewport.height - size.height - DOCK_MARGIN);
  return {
    right: Math.min(Math.max(anchor.right, DOCK_MARGIN), maxRight),
    bottom: Math.min(Math.max(anchor.bottom, DOCK_MARGIN), maxBottom)
  };
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
 * 视口尺寸。同时盯着 `resize` 与 `fullscreenchange`：
 * 前者管换分辨率 / 缩放窗口，后者管进出全屏 —— 全屏时会启用另一套更大号的样式，
 * 浮窗尺寸变了、可夹取的范围也跟着变，只监听 `resize` 在部分环境下会漏。
 */
function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  useEffect(() => {
    const sync = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", sync);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  return size;
}

/**
 * 全局浮动的「随机点名」小窗。
 *
 * 挂在 AppLayout 上，因此所有页面都能随手调出来 —— 上课玩到一半想点个名，
 * 不用离开游戏页去工具箱。它常驻不卸载，所以**一节课内点过的人会一直累积**
 * （换页面、开关面板都不会丢），「重置」按钮显式清零。
 *
 * 位置可以拖：**按住标题栏或右下角那个胶囊按钮拖动**即可挪走，位置记在
 * `POS_STORAGE_KEY` 里。默认钉在右下角，但游戏全屏、投影画面或别的浮层压在它上面时，
 * 它得能让开，所以位置可拖且会记住。
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
  const viewport = useViewportSize();

  const dockRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<DockRatio | null>(readStoredRatio);
  const [dockSize, setDockSize] = useState<Size>({ width: 0, height: 0 });
  /** 只有真的动起来了才置 true：光按一下不该让把手显示成"抓着" */
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<DragState | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  /** 拖动结束时浏览器会补一个 click，用它把那次点击吃掉，免得顺带把面板收起来 */
  const suppressClickRef = useRef(false);

  /**
   * 面板展开/收起、进出全屏都会改变浮窗尺寸，而尺寸一变可夹取的范围就变，
   * 所以持续观察它，而不是只在挂载时量一次。
   * `root` 也要进依赖：portal 换宿主（进出全屏）会把 dock 整个重挂载，旧节点已经脱离文档。
   */
  useLayoutEffect(() => {
    if (modalOpen) {
      return; // 有弹窗时浮窗整体不渲染，无从观察
    }
    const element = dockRef.current;
    if (!element) {
      return;
    }
    const sync = () => setDockSize({ width: element.offsetWidth, height: element.offsetHeight });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [modalOpen, root]);

  /** 实际下发的右下角坐标。从未拖动过就交给 CSS 默认值，老用户看到的样子完全不变。 */
  const anchor = useMemo(
    () =>
      ratio
        ? clampAnchor(
            { right: ratio.right * viewport.width, bottom: ratio.bottom * viewport.height },
            dockSize,
            viewport
          )
        : null,
    [ratio, viewport, dockSize]
  );

  function detachDragListeners() {
    if (detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
  }

  // 卸载 / 让位时把监听摘干净，别留下悬空的全局监听
  useEffect(() => detachDragListeners, []);

  /** 由指针位置反算浮窗右下角该落在哪（已夹进视口），并归一化成比例。 */
  function ratioFromPointer(drag: DragState, clientX: number, clientY: number): DockRatio {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const clamped = clampAnchor(
      {
        right: drag.startRight - (clientX - drag.startX),
        bottom: drag.startBottom - (clientY - drag.startY)
      },
      dockSize,
      { width, height }
    );
    return { right: clamped.right / width, bottom: clamped.bottom / height };
  }

  function onDragMove(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.lastX = clientX;
    drag.lastY = clientY;

    if (!drag.moved) {
      if (Math.hypot(clientX - drag.startX, clientY - drag.startY) < DRAG_THRESHOLD) {
        return; // 还只是按着时的手抖，继续按「点击」处理
      }
      drag.moved = true;
      setDragging(true);
    }
    setRatio(ratioFromPointer(drag, clientX, clientY));
  }

  /**
   * 结束一次拖动。
   *
   * ⚠️ 位置要用 `drag.lastX/lastY` 算，**不能**用松手事件自带的坐标：
   * 松手时指针常常已经不在把手上了（拖到角落被夹住、拖出面板之外），
   * 那一刻的坐标并不对应最后一次有效的移动。
   */
  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    detachDragListeners();
    setDragging(false);
    suppressClickRef.current = drag.moved;
    if (!drag.moved) {
      return;
    }
    const final = ratioFromPointer(drag, drag.lastX, drag.lastY);
    setRatio(final); // 只在结束时落盘：拖动过程中每帧都写 localStorage 没有意义
    storeRatio(final);
  }

  /**
   * 拖动期间在 **window** 上收指针事件，而不是只在把手上收。
   *
   * 两个理由，都是踩出来的：
   *  1. 指针离开把手后（拖得快、或被夹在屏幕角落而没能跟着走），把手就再也收不到事件了，
   *     拖动会中途"卡死"在最后一次有效位置上。`setPointerCapture` 是标准解法，
   *     但对合成输入等场景并不总是生效，所以不能只靠它。
   *  2. 松手时指针很可能已经不在把手上，靠把手自己的 pointerup 会漏掉，那一趟就白拖了
   *     （位置不落盘，下次打开又回原处）。pointercancel（触屏上手势被浏览器接管）同理。
   */
  function attachDragListeners() {
    detachDragListeners();
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && event.pointerId === drag.pointerId) {
        onDragMove(event.clientX, event.clientY);
      }
    };
    const end = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && event.pointerId === drag.pointerId) {
        finishDrag();
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    detachRef.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }

  function handleDragStart(
    event: ReactPointerEvent<HTMLElement>,
    options?: { skipButtons?: boolean }
  ) {
    if (event.button !== 0 || !event.isPrimary) {
      return; // 只认左键 / 第一根手指，右键菜单和中键不参与拖动
    }
    if (options?.skipButtons && (event.target as HTMLElement).closest("button")) {
      return; // 标题栏里的关闭按钮是独立交互，不该被当成拖动把手
    }
    const dock = dockRef.current;
    if (!dock) {
      return;
    }
    const rect = dock.getBoundingClientRect();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: window.innerWidth - rect.right,
      startBottom: window.innerHeight - rect.bottom,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false
    };
    attachDragListeners();
    try {
      // 捕获指针是额外保险：能手捕就手捕，失败也无所谓，window 上的监听已经兜住了
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件没有真实 pointerId 时会抛 NotFoundError
    }
  }

  function handleToggle() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((value) => !value);
  }

  // 有弹窗打开时整体让位。组件本身不卸载，点名进度原样保留。
  if (modalOpen) {
    return null;
  }

  const inFullscreen = root !== document.body;
  const canPick = !pick.rolling && pick.pool.length > 0;

  return createPortal(
    <div
      ref={dockRef}
      className={`fp-dock${open ? " is-open" : ""}${
        inFullscreen ? " is-fullscreen" : ""
      }${dragging ? " is-dragging" : ""}`}
      style={anchor ? { right: anchor.right, bottom: anchor.bottom } : undefined}
    >
      {open && (
        <section className="fp-window" role="region" aria-label="随机点名">
          <header
            className="fp-head"
            onPointerDown={(event) => handleDragStart(event, { skipButtons: true })}
          >
            <GripVertical className="fp-grip" size={14} aria-hidden />
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
        title="按住可拖动位置"
        onPointerDown={handleDragStart}
        onClick={handleToggle}
      >
        {open ? <X size={16} /> : <Dices size={16} />}
        {open ? "收起" : "随机点名"}
      </button>
    </div>,
    root
  );
}
