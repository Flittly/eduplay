import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listStudentClasses, listStudents } from "../api";
import type { Student } from "../types";

interface SeatingPageProps {
  token: string;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function buildSeatsFromIds(studentIds: number[], totalSeats: number): (number | null)[] {
  const seats: (number | null)[] = new Array(totalSeats).fill(null);
  studentIds.slice(0, totalSeats).forEach((studentId, index) => {
    seats[index] = studentId;
  });
  return seats;
}

function resizeSeats(
  current: (number | null)[],
  totalSeats: number,
  fallbackIds: number[]
): (number | null)[] {
  if (current.length === 0) {
    return buildSeatsFromIds(fallbackIds, totalSeats);
  }
  const next: (number | null)[] = new Array(totalSeats).fill(null);
  for (let index = 0; index < Math.min(current.length, totalSeats); index += 1) {
    next[index] = current[index];
  }
  const used = new Set(
    next.filter((studentId): studentId is number => studentId !== null)
  );
  const remainingIds = fallbackIds.filter((studentId) => !used.has(studentId));
  let remainingIndex = 0;
  for (let index = 0; index < next.length && remainingIndex < remainingIds.length; index += 1) {
    if (next[index] === null) {
      next[index] = remainingIds[remainingIndex];
      remainingIndex += 1;
    }
  }
  return next;
}

export default function SeatingPage({ token }: SeatingPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(8);
  const [seatAssignments, setSeatAssignments] = useState<(number | null)[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"ordered" | "random">("ordered");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const totalSeats = Math.max(0, rows) * Math.max(0, cols);
  const canFit = totalSeats >= students.length && students.length > 0;

  async function loadClasses() {
    try {
      const classes = await listStudentClasses(token);
      setClassList(classes);
      if (selectedClass !== "ALL" && !classes.includes(selectedClass)) {
        setSelectedClass("ALL");
      }
    } catch {
      setClassList([]);
    }
  }

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
          setSeatAssignments(
            buildSeatsFromIds(
              result.map((student) => student.id),
              totalSeats
            )
          );
          setMode("ordered");
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

    void loadClasses();
    void load();

    return () => {
      cancelled = true;
    };
  }, [token, selectedClass]);

  function arrangeOrdered() {
    setSeatAssignments(
      buildSeatsFromIds(
        students.map((student) => student.id),
        totalSeats
      )
    );
    setMode("ordered");
  }

  function arrangeRandom() {
    setSeatAssignments(
      buildSeatsFromIds(
        shuffle(students).map((student) => student.id),
        totalSeats
      )
    );
    setMode("random");
  }

  function handleRowsChange(rawValue: number) {
    const nextRows = Math.max(0, rawValue || 0);
    const nextTotal = nextRows * cols;
    setRows(nextRows);
    setSeatAssignments((current) =>
      resizeSeats(
        current,
        nextTotal,
        students.map((student) => student.id)
      )
    );
  }

  function handleColsChange(rawValue: number) {
    const nextCols = Math.max(0, rawValue || 0);
    const nextTotal = rows * nextCols;
    setCols(nextCols);
    setSeatAssignments((current) =>
      resizeSeats(
        current,
        nextTotal,
        students.map((student) => student.id)
      )
    );
  }

  function handleDrop(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      setDragIndex(null);
      return;
    }
    setSeatAssignments((current) => {
      if (
        fromIndex < 0 ||
        fromIndex >= current.length ||
        toIndex < 0 ||
        toIndex >= current.length
      ) {
        return current;
      }
      const studentId = current[fromIndex];
      if (studentId === null) {
        return current;
      }
      const next = [...current];
      next[fromIndex] = next[toIndex];
      next[toIndex] = studentId;
      return next;
    });
    setDragIndex(null);
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">工具箱</p>
          <h1>座位表</h1>
          <p>设置排数和列数，安排或随机排座位</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel seating-config">
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

        <div className="seating-config-row">
          <label className="seating-field">
            排数
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(event) =>
                handleRowsChange(Number(event.target.value))
              }
            />
          </label>
          <label className="seating-field">
            列数
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(event) =>
                handleColsChange(Number(event.target.value))
              }
            />
          </label>
          <button
            className="secondary"
            onClick={arrangeOrdered}
            disabled={students.length === 0}
          >
            按名单顺序
          </button>
          <button
            className="primary"
            onClick={arrangeRandom}
            disabled={students.length === 0}
          >
            随机排座
          </button>
          <span className="seating-summary">
            座位 {totalSeats} 个 · 学生 {students.length} 人
          </span>
        </div>

        {!canFit && students.length > 0 && (
          <p className="error-inline">
            当前座位数（{totalSeats}）小于学生人数（{students.length}），
            请增加排数或列数。
          </p>
        )}
        {mode === "random" && (
          <p className="seating-tip">当前为随机模式，再次点击“随机排座”可重新打乱。</p>
        )}
        {canFit && (
          <p className="seating-tip">排好后可直接拖动姓名，把学生换到其他座位。</p>
        )}
      </section>

      {loading ? (
        <p className="panel-empty">正在加载名单...</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <p>当前没有可安排座位的学生。</p>
          <Link className="primary button-link" to="/teacher/students">
            前往学生管理
          </Link>
        </div>
      ) : !canFit ? (
        <div className="empty-state">
          <p>请先调整座位排数和列数。</p>
        </div>
      ) : (
        <div className="seating-board">
          <div className="seating-stage">
            <span>讲台</span>
          </div>
          <div className="seating-grid-wrap">
            <div
              className="seating-grid"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
              }}
            >
              {seatAssignments.map((studentId, seatIndex) => {
                const rowIndex = Math.floor(seatIndex / cols);
                const colIndex = seatIndex % cols;
                const student =
                  studentId === null
                    ? null
                    : students.find((item) => item.id === studentId) ?? null;
                const canDrag = student !== null;

                return (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    className={`seat ${student ? "" : "seat-empty"} ${
                      dragIndex === seatIndex ? "seat-dragging" : ""
                    }`}
                    draggable={canDrag}
                    title={
                      student
                        ? `${student.name}（${rowIndex + 1}排${colIndex + 1}列），拖动可与他人交换`
                        : `空位（${rowIndex + 1}排${colIndex + 1}列）`
                    }
                    onDragStart={(event) => {
                      if (!canDrag) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(seatIndex));
                      setDragIndex(seatIndex);
                    }}
                    onDragOver={(event) => {
                      if (dragIndex !== null && canDrag) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      } else if (dragIndex !== null) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromIndex = Number(
                        event.dataTransfer.getData("text/plain")
                      );
                      if (Number.isInteger(fromIndex)) {
                        handleDrop(fromIndex, seatIndex);
                      }
                    }}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <span className="seat-position">
                      {rowIndex + 1}-{colIndex + 1}
                    </span>
                    {student ? student.name : "空"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="page-footer-actions">
        <Link className="secondary button-link" to="/tools">
          返回工具箱
        </Link>
      </div>
    </div>
  );
}
