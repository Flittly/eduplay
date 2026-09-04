import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
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

export default function GamePage({ token }: GamePageProps) {
  const { gameCode = "" } = useParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [installedGame, setInstalledGame] = useState<InstalledGame | null>(null);
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [started, setStarted] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [roundLogs, setRoundLogs] = useState<LoggedRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

      const target =
        payload.studentId != null
          ? selectedStudents.find(
              (student) => student.id === payload.studentId
            ) ?? null
          : selectedStudents.length === 1
            ? selectedStudents[0]
            : null;
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "积分结算失败");
      }
    },
    [gameCode, selectedStudents, token]
  );

  const sendInit = useCallback(() => {
    if (selectedStudents.length > 0 && installedGame) {
      iframeRef.current?.contentWindow?.postMessage(
        {
          source: "eduplay-platform",
          type: "GAME_INIT",
          payload: {
            gameCode,
            version: installedGame.installedVersion,
            roster: selectedStudents.map((student) => ({
              studentId: student.id,
              studentName: student.name,
              className: student.className ?? "未分班",
              studentNo: student.studentNo
            }))
          }
        },
        window.location.origin
      );
    }
  }, [gameCode, installedGame, selectedStudents]);

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
        const incoming: LoggedRound[] = (payload?.results ?? [])
          .filter(
            (item) =>
              typeof item.studentId === "number" &&
              typeof item.score === "number"
          )
          .map((item) => ({
            studentId: item.studentId as number,
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
            score: item.score as number,
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

  function handleStart() {
    setError("");
    setSessionDone(false);
    setRoundLogs([]);
    setStarted(true);
  }

  function backToLauncher() {
    setStarted(false);
    setSessionDone(false);
    setRoundLogs([]);
    setError("");
  }

  const entry = manifest?.entry?.replace(/^\/+/, "") ?? "";
  const playUrl =
    started && installedGame && entry
      ? `/api/v1/plugin/${encodeURIComponent(token)}/${encodeURIComponent(gameCode)}/${encodeURIComponent(installedGame.installedVersion)}/${entry}`
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

  return (
    <div className="page-content">
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
        </div>
        <h1>{installedGame.name}</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {sessionDone ? (
        <section className="result-card">
          <h2>拼图活动完成</h2>
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
                      {round.totalPoints != null
                        ? round.totalPoints
                        : "结算中…"}
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
        <div className="game-frame">
          {selectedStudents.length > 1 && (
            <p className="hint">
              已选择 {selectedStudents.length} 名学生，请在游戏内依次点名开始；
              每名学生完成后会自动计入成绩榜。
            </p>
          )}
          <iframe
            ref={iframeRef}
            key={playUrl}
            title={installedGame.name}
            src={playUrl}
            style={{
              width: "100%",
              height: selectedStudents.length > 1
                ? "calc(100vh - 180px)"
                : "calc(100vh - 150px)",
              minHeight: 540,
              border: "none",
              display: "block"
            }}
          />
        </div>
      ) : (
        <section className="game-launcher game-launcher-wide">
          <p>
            选择本次参与拼图的学生（可多选）。多位学生时将在游戏内轮流开始，
            右侧排行榜按完成用时排名。
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
          </div>

          {students.length === 0 ? (
            <p>
              还没有学生名单，请先到 <Link to="/teacher/students">学生管理</Link>{" "}
              导入学生。
            </p>
          ) : visibleStudents.length === 0 ? (
            <p className="hint">该班级还没有学生。</p>
          ) : (
            <div className="student-picker-list">
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
            disabled={selectedStudentIds.length === 0}
            onClick={handleStart}
          >
            开始游戏（{selectedStudentIds.length} 人）
          </button>
        </section>
      )}
    </div>
  );
}
