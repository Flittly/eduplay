import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listStudentClasses, listStudents } from "../api";
import type { Student } from "../types";

/** 滚动动画：24 次 × 80ms ≈ 1.9 秒，够看清名字在跳，又不用等得心焦。 */
export const ROLL_TICKS = 24;
export const ROLL_INTERVAL_MS = 80;

export interface RandomPickApi {
  /** 当前班级范围内的全部学生 */
  students: Student[];
  classList: string[];
  selectedClass: string;
  selectClass: (className: string) => void;
  loading: boolean;
  error: string;
  noRepeat: boolean;
  setNoRepeat: (value: boolean) => void;
  sessionCount: number;
  rolling: boolean;
  current: Student | null;
  /** 还能被抽到的人；「不重复点名」时已点过的会被剔掉 */
  pool: Student[];
  pick: () => void;
  resetPicked: () => void;
}

/**
 * 随机点名的抽取逻辑。
 *
 * 抽出来单独放，是因为它有两个界面在用：
 *   - `/tools/random-pick` 整页版（课前准备，要看全班名字）
 *   - 右下角浮窗版（课中随手点一个，不用离开当前页面，游戏全屏时也能用）
 * 两个界面**各自持有一份状态**（一份是备课用的，一份是课上即时用的），
 * 共享的只是这段逻辑 —— 以后改抽取规则（比如排除已答对的人）只需改这一处。
 */
export function useRandomPick(token: string): RandomPickApi {
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

  const stopRolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRolling(false);
  }, []);

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

  /**
   * 换班级、以及组件卸载（关掉浮窗、离开页面）时，把还没跑完的滚动停掉。
   *
   * 这里必须连 `rolling` 一起复位：定时器被清掉之后如果还留着 rolling=true，
   * 「开始点名」按钮会永远停在「抽取中…」且点不动 —— 页面版从 R11 起就有这个隐患
   * （切班级的那一刻正好在滚动中就会命中），抽到 hook 里一并修掉。
   */
  useEffect(() => stopRolling, [selectedClass, stopRolling]);

  const pool = useMemo(
    () => (noRepeat ? students.filter((item) => !pickedIds.has(item.id)) : students),
    [noRepeat, pickedIds, students]
  );

  const pick = useCallback(() => {
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
          setPickedIds((previous) => new Set(previous).add(candidate.id));
        }
      }
    }, ROLL_INTERVAL_MS);
  }, [noRepeat, pool, rolling]);

  const resetPicked = useCallback(() => {
    stopRolling();
    setPickedIds(new Set());
    setSessionCount(0);
  }, [stopRolling]);

  return {
    students,
    classList,
    selectedClass,
    selectClass: setSelectedClass,
    loading,
    error,
    noRepeat,
    setNoRepeat,
    sessionCount,
    rolling,
    current,
    pool,
    pick,
    resetPicked
  };
}
