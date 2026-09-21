import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listStudentClasses, listStudents } from "../api";
import { useRosterVersion } from "../rosterStore";
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

  /**
   * 名单在别处被改过（导入名单、增删改学生、删班级）就会变 —— 取数 effect 的依赖之一。
   *
   * 必须有它：本 hook 的宿主浮窗挂在 `AppLayout` 上、登录后只挂载一次，
   * 光靠 `[token, selectedClass]` 的话，导入完名单班级下拉不会更新，非重新登录不可。
   */
  const rosterVersion = useRosterVersion();

  const stopRolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRolling(false);
  }, []);

  /**
   * 取数：当前班级的学生名单 + 班级下拉的选项。
   *
   * ⚠️ 这里**只负责把数据拉进来、不重置本轮进度**。
   * 因为触发源有两类，语义不一样：
   *   - `token` / `selectedClass` 变（换登录、换班级）→ 换班级要开新一轮，重置放在 `selectClass` 里；
   *   - `rosterVersion` 变（别处改了名单）→ 老师很可能正上着课，**导入/删了个人不该把
   *     「已点过谁、这一轮点了几个」抹掉**。
   * 早先版本把重置写在 `load()` 里面，那时只有第一类触发源所以没问题；
   * 加了第二类之后就必须拆开，否则换个名单就把课堂进度清了。
   */
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
          // 显示中的这位可能刚被删掉/调班了 ⇒ 不再显示一个已不存在的人。
          setCurrent((previous) =>
            previous && result.some((item) => item.id === previous.id)
              ? previous
              : null
          );
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
          // 当前选中的班级可能刚在别处被删掉 ⇒ 退回「全部班级」。
          // 否则浮窗会停在一个已经不存在的班级上，名单永远是空的，而且没人知道为什么。
          // （与 `StudentRosterPage.reloadClasses` 的兜底保持一致。）
          setSelectedClass((previous) =>
            previous !== "ALL" && !classes.includes(previous) ? "ALL" : previous
          );
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
  }, [token, selectedClass, rosterVersion]);

  /**
   * 换班级、以及组件卸载（关掉浮窗、离开页面）时，把还没跑完的滚动停掉。
   *
   * 这里必须连 `rolling` 一起复位：定时器被清掉之后如果还留着 rolling=true，
   * 「开始点名」按钮会永远停在「抽取中…」且点不动 —— 页面版从 R11 起就有这个隐患
   * （切班级的那一刻正好在滚动中就会命中），抽到 hook 里一并修掉。
   */
  useEffect(() => stopRolling, [selectedClass, stopRolling]);

  /**
   * 换班级 = 开新一轮，所以重置动作**显式绑在这个动作上**，而不是藏在取数 effect 里。
   *
   * 早先版本把 `pickedIds`/`sessionCount`/`current` 的重置写在取数 effect 内部，
   * 那时 effect 只有「换班级 / 换登录」两类触发源，所以读起来没问题；
   * 现在 effect 多了「别处改了名单」（`rosterVersion`）这一类，再放在里面
   * 就会把老师这一轮的课堂进度一起清掉，所以拆出来。
   */
  const selectClass = useCallback(
    (className: string) => {
      stopRolling();
      setPickedIds(new Set());
      setSessionCount(0);
      setCurrent(null);
      setSelectedClass(className);
    },
    [stopRolling]
  );

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
    selectClass,
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
