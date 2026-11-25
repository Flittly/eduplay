import { Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createPlayTicket,
  getInstalledManifest,
  listInstalledGames,
  listStudentClasses,
  listStudents,
  submitGameScore
} from "../api";
import type { GameManifest, GameScoreResult, InstalledGame, Student } from "../types";

interface GamePageProps {
  token: string;
}

interface GameCompletePayload {
  roundId?: string;
  studentId?: number;
  studentName?: string;
  score?: number;
  timeSeconds?: number;
  correctCount?: number;
  totalCount?: number;
}

interface SessionRoundResult {
  studentId?: number;
  studentName?: string;
  className?: string | null;
  studentNo?: string | null;
  score?: number;
  timeSeconds?: number;
  correctCount?: number;
  totalCount?: number;
  mistakes?: number;
}

interface SessionCompletePayload {
  results?: SessionRoundResult[];
}

interface LoggedRound {
  studentId: number;
  studentName: string;
  className: string | null;
  studentNo: string;
  score: number;
  timeSeconds: number | null;
  recorded?: boolean;
  totalPoints?: number;
}

function upsertRounds(
  current: LoggedRound[],
  incoming: LoggedRound[]
): LoggedRound[] {
  const map = new Map<number, LoggedRound>();
  for (const item of current) {
    map.set(item.studentId, item);
  }
  for (const item of incoming) {
    const existing = map.get(item.studentId);
    map.set(item.studentId, {
      ...existing,
      ...item,
      recorded: item.recorded ?? existing?.recorded,
      totalPoints: item.totalPoints ?? existing?.totalPoints,
      timeSeconds: item.timeSeconds ?? existing?.timeSeconds ?? null,
      score: item.score ?? existing?.score ?? 0
    });
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.timeSeconds ?? Number.POSITIVE_INFINITY) -
        (b.timeSeconds ?? Number.POSITIVE_INFINITY) ||
      b.score - a.score ||
      a.studentName.localeCompare(b.studentName, "zh-CN")
  );
}

/**
 * 取出游戏 iframe 的 document（平台与游戏包同源）。
 * 同源时焦点落在游戏内部，按键事件不会冒泡到平台页面，
 * 因此需要在游戏的 document 上补挂一次 Esc 监听。
 * 若将来游戏改为跨域加载，这里会抛异常，兜底返回 null。
 */
function readIframeDocument(frame: HTMLIFrameElement | null): Document | null {
  if (!frame) {
    return null;
  }
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

export default function GamePage({ token }: GamePageProps) {
  const { gameCode = "" } = useParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  // 标记「原生全屏是本次由平台申请的」，退出时才知道需不需要主动调 exitFullscreen
  const ownsNativeFullscreenRef = useRef(false);

  const [installedGame, setInstalledGame] = useState<InstalledGame | null>(null);
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [pickMode, setPickMode] = useState<"manual" | "random">("manual");
  const [randomCount, setRandomCount] = useState(1);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  // 进入游戏用的短期票据（见后端 PluginPlayTicketService）：
  // 只有它能出现在 iframe 的 URL 里，主登录 token 不再进入任何 URL。
  const [playTicket, setPlayTicket] = useState<string | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roundLogs, setRoundLogs] = useState<LoggedRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 每次「重新加载游戏」加一，配合 iframe 的 key 强制重挂载 ——
  // 比在游戏内部调 location.reload() 更彻底：游戏包自己卡住时，
  // 那段 JS 可能已经跑不动了，只有平台侧把它换掉才救得回来。
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const installedGames = await listInstalledGames(token);
        const game = installedGames.find((item) => item.gameCode === gameCode);
        if (!game) {
          throw new Error("该游戏尚未安装，请先到游戏商城安装");
        }

        const gameManifest = await getInstalledManifest(token, gameCode);
        const [classNames, studentList] = await Promise.all([
          listStudentClasses(token),
          listStudents(token)
        ]);

        if (!cancelled) {
          setInstalledGame(game);
          setManifest(gameManifest);
          setClasses(classNames);
          setStudents(studentList);
          if (classNames.length === 1) {
            setSelectedClass(classNames[0]);
          }
          // 展示型游戏不需要选学生，加载完成后直接进入。
          if (gameManifest.requiresRoster === false) {
            setStarted(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载游戏失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [gameCode, token]);

  const selectedStudents = useMemo(
    () =>
      students.filter((student) =>
        selectedStudentIds.includes(student.id)
      ),
    [selectedStudentIds, students]
  );

  const visibleStudents = selectedClass
    ? students.filter(
        (student) => (student.className ?? "未分班") === selectedClass
      )
    : students;

  const submitComplete = useCallback(
    async (payload: GameCompletePayload) => {
      if (selectedStudents.length === 0) {
        setError("未选择学生，无法结算积分");
        return;
      }

      // 游戏回传的 id 可能来自 localStorage / data-* 属性，是字符串。
      // 严格 === 比对会让 "12" 匹配不上 12，成绩就这么静默丢了，
      // 界面还只说「学生不在本次选择名单中」，排查成本极高。
      const requestedId =
        payload.studentId == null ? null : Number(payload.studentId);
      let target: Student | null = null;
      if (requestedId != null) {
        target = Number.isFinite(requestedId)
          ? selectedStudents.find((student) => student.id === requestedId) ??
            null
          : null;
      } else if (selectedStudents.length === 1) {
        target = selectedStudents[0];
      }
      if (!target) {
        setError("游戏返回的学生不在本次选择名单中，无法结算积分");
        return;
      }

      const score = payload.score;
      const roundId = payload.roundId;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
        setError("游戏返回的积分不合法");
        return;
      }
      if (!roundId) {
        setError("游戏返回的回合计分标识缺失");
        return;
      }

      try {
        const scoreResult: GameScoreResult = await submitGameScore(
          token,
          gameCode,
          {
            studentId: target.id,
            score: Math.round(score),
            roundId
          }
        );
        setRoundLogs((current) =>
          upsertRounds(current, [
            {
              studentId: scoreResult.id,
              studentName: scoreResult.name,
              className: scoreResult.className,
              studentNo: scoreResult.studentNo,
              score: scoreResult.score,
              timeSeconds:
                typeof payload.timeSeconds === "number"
                  ? payload.timeSeconds
                  : null,
              recorded: scoreResult.recorded,
              totalPoints: scoreResult.totalPoints
            }
          ])
        );
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "积分结算失败");
      }
    },
    [gameCode, selectedStudents, token]
  );

  const sendInit = useCallback(() => {
    if (!installedGame || !manifest) {
      return;
    }
    const needsRoster = manifest.requiresRoster !== false;
    // 展示型游戏直接发空 roster；积分型游戏必须选过学生才发。
    if (needsRoster && selectedStudents.length === 0) {
      return;
    }
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "eduplay-platform",
        type: "GAME_INIT",
        payload: {
          gameCode,
          version: installedGame.installedVersion,
          roster: needsRoster
            ? selectedStudents.map((student) => ({
                studentId: student.id,
                studentName: student.name,
                className: student.className ?? "未分班",
                studentNo: student.studentNo
              }))
            : []
        }
      },
      window.location.origin
    );
  }, [gameCode, installedGame, manifest, selectedStudents]);

  /**
   * 退出全屏：先收掉页面内的大屏覆盖层，再按需关闭原生全屏。
   * 两者都做，保证「按 Esc 退出」和「点按钮退出」走同一条路径。
   */
  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false);
    if (ownsNativeFullscreenRef.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        // 浏览器/Electron 已自行退出全屏，忽略
      });
    }
    ownsNativeFullscreenRef.current = false;
  }, []);

  // 进入大屏：请求原生全屏（铺满整块屏幕），失败则退化为页面内覆盖层。
  // 同时监听 Esc 与 fullscreenchange —— 后者负责「用户按 Esc 让浏览器退出全屏」这条路径。
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const element = gameFrameRef.current;
    if (element && typeof element.requestFullscreen === "function") {
      element
        .requestFullscreen()
        .then(() => {
          ownsNativeFullscreenRef.current = true;
        })
        .catch(() => {
          ownsNativeFullscreenRef.current = false;
        });
    }

    const attachedDocs: Document[] = [];

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        exitFullscreen();
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        ownsNativeFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    }

    function attach(doc: Document | null) {
      if (!doc || attachedDocs.includes(doc)) {
        return;
      }
      // 用捕获阶段，避免被游戏自身的 keydown 处理吞掉
      doc.addEventListener("keydown", handleEscape, true);
      attachedDocs.push(doc);
    }

    attach(document);
    attach(readIframeDocument(iframeRef.current));

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      for (const doc of attachedDocs) {
        doc.removeEventListener("keydown", handleEscape, true);
      }
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [exitFullscreen, isFullscreen]);

  // 游戏结束 / 返回重选时，不能把大屏状态留到下一局
  useEffect(() => {
    if (!started && isFullscreen) {
      exitFullscreen();
    }
  }, [exitFullscreen, isFullscreen, started]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        message.source !== "eduplay-game"
      ) {
        return;
      }

      if (message.type === "GAME_READY") {
        sendInit();
      } else if (message.type === "GAME_COMPLETE") {
        void submitComplete(message.payload as GameCompletePayload);
      } else if (message.type === "GAME_SESSION_COMPLETE") {
        const payload = message.payload as SessionCompletePayload | undefined;
        // 同 submitComplete：id / 分数可能以字符串形式回传，先归一化再判断，
        // 否则整行成绩会被静默过滤掉。
        const incoming: LoggedRound[] = (payload?.results ?? [])
          .filter(
            (item) =>
              Number.isFinite(Number(item.studentId)) &&
              Number.isFinite(Number(item.score))
          )
          .map((item) => ({
            studentId: Number(item.studentId),
            studentName:
              typeof item.studentName === "string"
                ? (item.studentName as string)
                : "",
            className: typeof item.className === "string"
              ? (item.className as string)
              : null,
            studentNo:
              typeof item.studentNo === "string"
                ? (item.studentNo as string)
                : "",
            score: Number(item.score),
            timeSeconds:
              typeof item.timeSeconds === "number"
                ? (item.timeSeconds as number)
                : null
          }));
        setRoundLogs((current) => upsertRounds(current, incoming));
        setStarted(false);
        setSessionDone(true);
      } else if (message.type === "GAME_ERROR") {
        setError(
          typeof message.payload?.message === "string"
            ? message.payload.message
            : "游戏运行出错"
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendInit, submitComplete]);

  function handleClassChange(className: string) {
    setSelectedClass(className);
    setSelectedStudentIds([]);
  }

  function changePickMode(mode: "manual" | "random") {
    if (pickMode === mode) {
      return;
    }
    setPickMode(mode);
    setSelectedStudentIds([]);
  }

  function drawRandomStudents() {
    if (visibleStudents.length === 0) {
      return;
    }
    const pool = [...visibleStudents];
    const count = Math.max(
      1,
      Math.min(Math.round(randomCount) || 1, pool.length)
    );
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setSelectedStudentIds(pool.slice(0, count).map((student) => student.id));
  }

  function toggleStudent(studentId: number) {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  }

  function selectVisibleStudents() {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      for (const student of visibleStudents) {
        next.add(student.id);
      }
      return [...next];
    });
  }

  function clearSelection() {
    setSelectedStudentIds([]);
  }

  async function requestPlayTicket(): Promise<boolean> {
    if (!installedGame) {
      return false;
    }
    try {
      const issued = await createPlayTicket(
        token,
        gameCode,
        installedGame.installedVersion
      );
      setPlayTicket(issued.ticket);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取游戏访问凭证失败");
      return false;
    }
  }

  async function handleStart() {
    setError("");
    setSessionDone(false);
    setRoundLogs([]);
    setStarting(true);
    try {
      if (await requestPlayTicket()) {
        setStarted(true);
      }
    } finally {
      setStarting(false);
    }
  }

  function backToLauncher() {
    setStarted(false);
    setSessionDone(false);
    setRoundLogs([]);
    setError("");
  }

  /**
   * 重新加载游戏：只把游戏 iframe 换掉，平台状态（登录、当前页面、已选学生、
   * 已结算的成绩榜）全部保留。新 iframe 加载完会重新发 GAME_READY，
   * 平台按原来的名单再发一次 GAME_INIT，等同于「重开这一局」。
   *
   * 为什么走「重挂载」而不是在游戏内部调 location.reload()：
   * 游戏卡住时它自己那段 JS 很可能已经跑不动了，只有平台侧把它整个换掉才救得回来。
   */
  async function reloadGame() {
    setError("");
    // 票据有有效期：重开前顺手换一张，避免「电脑睡了一夜后再重开」拿到过期票据。
    await requestPlayTicket();
    setReloadNonce((current) => current + 1);
  }

  const entry = manifest?.entry?.replace(/^\/+/, "") ?? "";
  const playUrl =
    started && playTicket && installedGame && entry
      ? `/api/v1/plugin/${encodeURIComponent(playTicket)}/${encodeURIComponent(gameCode)}/${encodeURIComponent(installedGame.installedVersion)}/${entry}`
      : null;

  function formatTime(value: number | null): string {
    if (value == null || !Number.isFinite(value)) {
      return "-";
    }
    const total = Math.max(0, Math.floor(value));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div className="page-content">
        <p>正在加载游戏...</p>
        <Link className="secondary button-link" to="/">返回游戏中心</Link>
      </div>
    );
  }

  if (!installedGame || !manifest) {
    return (
      <div className="page-content">
        <p className="error">{error || "游戏不存在或未安装"}</p>
        <Link className="secondary button-link" to="/">
          返回游戏中心
        </Link>
      </div>
    );
  }

  // 游戏是否需要选人：manifest.requiresRoster 显式为 false 时直接进入。
  const needsRoster = manifest.requiresRoster !== false;

  // 游戏区顶部：全屏时是工具条，非全屏时仅对积分型游戏显示选人提示。
  // 两者共用一个插槽，保证下面的 iframe 在切换全屏时位置不变、不被重新挂载（否则游戏会重开）。
  const gameFrameHead = isFullscreen ? (
    <div className="game-frame-bar">
      <span className="game-frame-bar-title">{installedGame.name}</span>
      <span className="game-frame-bar-hint">按 Esc 退出全屏</span>
      <button className="secondary" type="button" onClick={reloadGame}>
        <RotateCw size={16} />
        重新加载游戏
      </button>
      <button className="secondary" type="button" onClick={exitFullscreen}>
        <Minimize2 size={16} />
        退出全屏
      </button>
    </div>
  ) : needsRoster && selectedStudents.length > 1 ? (
    <p className="hint">
      已选择 {selectedStudents.length} 名学生，请在游戏内依次点名开始；
      每名学生完成后会自动计入成绩榜。
    </p>
  ) : null;

  return (
    <div className="page-content page-wide">
      <header className="page-header">
        <div className="page-header-actions">
          <Link className="secondary button-link" to="/">返回游戏中心</Link>
          {started && (
            <button
              className="secondary button-link"
              type="button"
              onClick={backToLauncher}
            >
              返回重选
            </button>
          )}
          {started && playUrl && !isFullscreen && (
            <button
              className="secondary button-link"
              type="button"
              onClick={reloadGame}
            >
              <RotateCw size={16} />
              重新加载游戏
            </button>
          )}
          {started && playUrl && !isFullscreen && (
            <button
              className="secondary button-link"
              type="button"
              onClick={() => setIsFullscreen(true)}
            >
              <Maximize2 size={16} />
              全屏显示
            </button>
          )}
        </div>
        <h1>{installedGame.name}</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {sessionDone ? (
        <section className="result-card">
          {/* 这是通用结算页，所有游戏共用；写死「拼图」会让数学/英语游戏
              的结算页出现不相干的活动名。 */}
          <h2>{installedGame.name} · 本轮完成</h2>
          <p>
            共 {roundLogs.length} 名学生完成，按用时从少到多排列：
          </p>
          {roundLogs.length > 0 ? (
            <table className="result-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>用时</th>
                  <th>本局得分</th>
                  <th>最新总积分</th>
                </tr>
              </thead>
              <tbody>
                {roundLogs.map((round, index) => (
                  <tr key={round.studentId}>
                    <td>{index + 1}</td>
                    <td>{round.studentName}</td>
                    <td>{round.className ?? "-"}</td>
                    <td>{formatTime(round.timeSeconds)}</td>
                    <td>{round.score}</td>
                    <td>
                      {/* 连局模式下游戏只回传本局得分，平台拿不到最新总积分。
                          原来写「结算中…」会永久停留，看着像卡死。 */}
                      {round.totalPoints != null ? round.totalPoints : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>游戏已结束，但暂未收到成绩数据。</p>
          )}
          <div className="result-actions">
            <Link className="primary button-link" to="/">
              返回游戏中心
            </Link>
            <button
              className="secondary"
              type="button"
              onClick={backToLauncher}
            >
              再选一批学生
            </button>
          </div>
        </section>
      ) : started && playUrl ? (
        <div
          ref={gameFrameRef}
          className={isFullscreen ? "game-frame is-fullscreen" : "game-frame"}
        >
          {gameFrameHead}
          <iframe
            ref={iframeRef}
            key={`${playUrl}#${reloadNonce}`}
            title={installedGame.name}
            src={playUrl}
            allowFullScreen
            /* 令牌就在 src 里，游戏包一旦引用外链字体/CDN，
               Referer 会把整条带令牌的 URL 送到第三方站点。 */
            referrerPolicy="no-referrer"
            style={{
              width: "100%",
              height: isFullscreen
                ? "100%"
                : needsRoster && selectedStudents.length > 1
                  ? "calc(100vh - 180px)"
                  : "calc(100vh - 150px)",
              minHeight: isFullscreen ? 0 : 540,
              border: "none",
              display: "block"
            }}
          />
        </div>
      ) : (
        <section className="game-launcher game-launcher-wide">
          <p>
            选择本次参与游戏的学生，支持两种方式：手动勾选，或随机抽取指定人数。
            多位学生时将在游戏内依次开始，右侧排行榜按完成用时排名。
          </p>

          <label className="field">
            班级
            <select
              value={selectedClass}
              onChange={(event) => handleClassChange(event.target.value)}
            >
              <option value="">全部班级</option>
              {classes.map((className) => (
                <option key={className} value={className}>
                  {className}
                </option>
              ))}
            </select>
          </label>

          <div className="student-picker-toolbar">
            <strong>学生名单</strong>
            <span>已选 {selectedStudentIds.length} 人</span>
            <div className="pick-mode-toggle" role="group" aria-label="选择方式">
              <button
                type="button"
                className={pickMode === "manual" ? "is-active" : ""}
                onClick={() => changePickMode("manual")}
              >
                勾选选择
              </button>
              <button
                type="button"
                className={pickMode === "random" ? "is-active" : ""}
                onClick={() => changePickMode("random")}
              >
                🎲 随机抽取
              </button>
            </div>
            {pickMode === "manual" ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={visibleStudents.length === 0}
                  onClick={selectVisibleStudents}
                >
                  全选当前名单
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={selectedStudentIds.length === 0}
                  onClick={clearSelection}
                >
                  清空
                </button>
              </>
            ) : (
              <>
                <label className="random-count-field">
                  抽取人数
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, visibleStudents.length)}
                    value={randomCount}
                    disabled={visibleStudents.length === 0}
                    onChange={(event) =>
                      setRandomCount(Number(event.target.value) || 1)
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={visibleStudents.length === 0}
                  onClick={drawRandomStudents}
                >
                  随机抽取
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={selectedStudentIds.length === 0}
                  onClick={clearSelection}
                >
                  清空
                </button>
              </>
            )}
          </div>

          {pickMode === "random" && visibleStudents.length > 0 && (
            <p className="hint">
              随机抽取模式：点击「随机抽取」将从当前名单中随机抽取指定人数（不重复），
              结果自动勾选在下方名单中，可反复重新抽取。
            </p>
          )}

          {students.length === 0 ? (
            <p>
              还没有学生名单，请先到 <Link to="/teacher/students">学生管理</Link>{" "}
              导入学生。
            </p>
          ) : visibleStudents.length === 0 ? (
            <p className="hint">该班级还没有学生。</p>
          ) : (
            <div
              className={
                pickMode === "random"
                  ? "student-picker-list is-random"
                  : "student-picker-list"
              }
            >
              {visibleStudents.map((student) => {
                const checked = selectedStudentIds.includes(student.id);
                return (
                  <label
                    key={student.id}
                    className={
                      checked
                        ? "student-picker-row is-selected"
                        : "student-picker-row"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={pickMode === "random"}
                      onChange={() => toggleStudent(student.id)}
                    />
                    <span className="student-picker-name">{student.name}</span>
                    <span className="student-picker-no">
                      {student.studentNo}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <button
            className="primary"
            type="button"
            disabled={selectedStudentIds.length === 0 || starting}
            onClick={handleStart}
          >
            {starting ? "正在准备游戏..." : `开始游戏（${selectedStudentIds.length} 人）`}
          </button>
        </section>
      )}
    </div>
  );
}
