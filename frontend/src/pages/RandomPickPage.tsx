import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listStudentClasses, listStudents } from "../api";
import type { Student } from "../types";

interface RandomPickPageProps {
  token: string;
}

const ROLL_TICKS = 24;
const ROLL_INTERVAL_MS = 80;

export default function RandomPickPage({ token }: RandomPickPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [noRepeat, setNoRepeat] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [sessionCount, setSessionCount] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [current, setCurrent] = useState<Student | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result =
          selectedClass === "ALL"
            ? await listStudents(token)
            : await listStudents(token, { className: selectedClass });
        if (!cancelled) {
          setStudents(result);
          setPickedIds(new Set());
          setSessionCount(0);
          setCurrent(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载学生名单失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function loadClasses() {
      try {
        const classes = await listStudentClasses(token);
        if (!cancelled) {
          setClassList(classes);
        }
      } catch {
        if (!cancelled) {
          setClassList([]);
        }
      }
    }

    void loadClasses();
    void load();

    return () => {
      cancelled = true;
    };
  }, [token, selectedClass]);

  // 切换班级时停止滚动
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [selectedClass]);

  const pool = noRepeat
    ? students.filter((student) => !pickedIds.has(student.id))
    : students;

  function pick() {
    if (rolling || pool.length === 0) {
      return;
    }
    setRolling(true);
    let ticks = 0;
    timerRef.current = window.setInterval(() => {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      setCurrent(candidate);
      ticks += 1;
      if (ticks >= ROLL_TICKS && timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
        setRolling(false);
        setSessionCount((count) => count + 1);
        if (noRepeat) {
          const chosen = candidate;
          setPickedIds((previous) => new Set(previous).add(chosen.id));
        }
      }
    }, ROLL_INTERVAL_MS);
  }

  function resetPicked() {
    setPickedIds(new Set());
    setSessionCount(0);
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">工具箱</p>
          <h1>随机点名</h1>
          <p>从学生名单中随机抽取一名同学，学号姓名大屏展示</p>
        </div>
        <div className="points-card">
          <span>已抽到</span>
          <strong>{sessionCount}</strong>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel roll-toolbar">
        <div className="class-tabs">
          <button
            className={selectedClass === "ALL" ? "active" : ""}
            onClick={() => setSelectedClass("ALL")}
          >
            全部班级
          </button>
          {classList.map((className) => (
            <button
              key={className}
              className={selectedClass === className ? "active" : ""}
              onClick={() => setSelectedClass(className)}
            >
              {className}
            </button>
          ))}
        </div>
        <div className="roll-actions">
          <label className="pick-norepeat">
            <input
              type="checkbox"
              checked={noRepeat}
              onChange={(event) => {
                if (rolling) {
                  return;
                }
                setNoRepeat(event.target.checked);
              }}
            />
            不重复点名
          </label>
          <button
            className="secondary"
            disabled={sessionCount === 0 || rolling}
            onClick={resetPicked}
          >
            重置已抽名单
          </button>
        </div>
      </section>

      {loading ? (
        <p className="panel-empty">正在加载名单...</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <p>当前班级没有学生，请先在学生管理中导入名单。</p>
          <Link className="primary button-link" to="/teacher/students">
            前往学生管理
          </Link>
        </div>
      ) : (
        <>
          <section
            className={`panel pick-stage${rolling ? " pick-stage-rolling" : ""}${
              current && !rolling ? " pick-stage-settled" : ""
            }`}
          >
            {current ? (
              <>
                <p className="pick-kicker">
                  {rolling
                    ? "正在抽取…"
                    : selectedClass === "ALL"
                      ? "被点到的同学是"
                      : `${selectedClass} · 被点到的同学是`}
                </p>
                <p className="pick-name">{current.name}</p>
                <p className="pick-no">学号 {current.studentNo}</p>
              </>
            ) : (
              <>
                <p className="pick-name pick-name-idle">？</p>
                <p className="pick-no pick-no-idle">
                  点击下方按钮开始随机点名
                </p>
              </>
            )}
          </section>

          <div className="pick-actions">
            <button
              className="pick-go"
              disabled={rolling || pool.length === 0}
              onClick={pick}
            >
              {rolling
                ? "抽取中…"
                : pool.length === 0
                  ? "全班都抽过了，请重置"
                  : current
                    ? "再抽一个"
                    : "开始点名"}
            </button>
            {noRepeat && students.length > 0 && (
              <p className="pick-pool-tip">
                本轮剩余可选 {pool.length} / {students.length} 人
              </p>
            )}
          </div>
        </>
      )}

      <div className="page-footer-actions">
        <Link className="secondary button-link" to="/tools">
          返回工具箱
        </Link>
      </div>
    </div>
  );
}
