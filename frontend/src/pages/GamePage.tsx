import { useCallback, useEffect, useRef, useState } from "react";
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
  score?: number;
  correctCount?: number;
  totalCount?: number;
}

export default function GamePage({ token }: GamePageProps) {
  const { gameCode = "" } = useParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [installedGame, setInstalledGame] = useState<InstalledGame | null>(null);
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<GameScoreResult | null>(null);
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

  const selectedStudent = students.find(
    (student) => student.id === selectedStudentId
  ) ?? null;

  const submitComplete = useCallback(
    async (payload: GameCompletePayload) => {
      if (!selectedStudent) {
        setError("未选择学生，无法结算积分");
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
        const scoreResult = await submitGameScore(token, gameCode, {
          studentId: selectedStudent.id,
          score: Math.round(score),
          roundId
        });
        setResult(scoreResult);
        setStarted(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "积分结算失败");
      }
    },
    [gameCode, selectedStudent, token]
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const message = event.data;
      if (!message || typeof message !== "object" || message.source !== "eduplay-game") {
        return;
      }

      if (message.type === "GAME_READY") {
        if (selectedStudent && installedGame) {
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: "eduplay-platform",
              type: "GAME_INIT",
              payload: {
                gameCode,
                version: installedGame.installedVersion,
                studentId: selectedStudent.id,
                studentName: selectedStudent.name,
                className: selectedStudent.className ?? "未分班"
              }
            },
            window.location.origin
          );
        }
      } else if (message.type === "GAME_COMPLETE") {
        void submitComplete(message.payload as GameCompletePayload);
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
  }, [gameCode, installedGame, selectedStudent, submitComplete]);

  function handleClassChange(className: string) {
    setSelectedClass(className);
    setSelectedStudentId(null);
  }

  function handleStart() {
    setResult(null);
    setError("");
    setStarted(true);
  }

  const visibleStudents = selectedClass
    ? students.filter(
        (student) => (student.className ?? "未分班") === selectedClass
      )
    : students;

  const entry = manifest?.entry?.replace(/^\/+/, "") ?? "";
  const playUrl =
    started && installedGame && entry
      ? `/api/v1/plugin/${encodeURIComponent(token)}/${encodeURIComponent(gameCode)}/${encodeURIComponent(installedGame.installedVersion)}/${entry}`
      : null;

  if (loading) {
    return (
      <div className="page-content">
        <p>正在加载游戏...</p>
        <Link to="/">返回游戏中心</Link>
      </div>
    );
  }

  if (!installedGame || !manifest) {
    return (
      <div className="page-content">
        <p className="error">{error || "游戏不存在或未安装"}</p>
        <Link className="button-link" to="/">
          返回游戏中心
        </Link>
      </div>
    );
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <Link to="/">返回游戏中心</Link>
        <h1>{installedGame.name}</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {result ? (
        <section className="result-card">
          <h2>游戏完成</h2>
          <p>
            {result.name} 获得 {result.score} 分，当前总积分 {result.totalPoints}
          </p>
          {!result.recorded && result.score > 0 && (
            <p className="hint">该次成绩已记录过，不会重复加分</p>
          )}
          <Link className="primary button-link" to="/">
            返回游戏中心
          </Link>
        </section>
      ) : started && playUrl ? (
        <div className="game-frame">
          <button className="button-link" type="button" onClick={() => setStarted(false)}>
            返回重选
          </button>
          <iframe
            ref={iframeRef}
            key={playUrl}
            title={installedGame.name}
            src={playUrl}
            style={{
              width: "100%",
              minHeight: "78vh",
              border: "none"
            }}
          />
        </div>
      ) : (
        <section className="game-launcher">
          <p>开始前请选择本次要计分的学生：</p>

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

          <label className="field">
            学生
            <select
              value={selectedStudentId ?? ""}
              onChange={(event) =>
                setSelectedStudentId(
                  event.target.value ? Number(event.target.value) : null
                )
              }
            >
              <option value="">请选择学生</option>
              {visibleStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}（{student.studentNo}）
                </option>
              ))}
            </select>
          </label>

          {students.length === 0 ? (
            <p>
              还没有学生名单，请先到 <Link to="/students">学生管理</Link> 导入学生。
            </p>
          ) : null}

          <button
            className="primary button-link"
            type="button"
            disabled={!selectedStudent}
            onClick={handleStart}
          >
            开始游戏
          </button>
        </section>
      )}
    </div>
  );
}
