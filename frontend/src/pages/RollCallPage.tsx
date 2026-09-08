import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listStudentClasses, listStudents } from "../api";
import type { Student } from "../types";

interface RollCallPageProps {
  token: string;
}

export default function RollCallPage({ token }: RollCallPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          setPendingIds(new Set(result.map((student) => student.id)));
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

  function toggleStudent(studentId: number) {
    setPendingIds((previous) => {
      const next = new Set(previous);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  const calledStudents = students.filter(
    (student) => !pendingIds.has(student.id)
  );
  const pendingStudents = students.filter((student) =>
    pendingIds.has(student.id)
  );

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">工具箱</p>
          <h1>课堂点名</h1>
          <p>点击姓名切换状态，点到右边即表示已点名</p>
        </div>
        <div className="points-card">
          <span>已点名</span>
          <strong>{calledStudents.length}</strong>
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
          <button
            className="secondary"
            disabled={pendingStudents.length === 0}
            onClick={() =>
              setPendingIds(new Set(students.map((student) => student.id)))
            }
          >
            全部重置为未点名
          </button>
        </div>
      </section>

      {loading ? (
        <p className="panel-empty">正在加载名单...</p>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <p>当前没有可点名的学生。</p>
          <Link className="primary button-link" to="/teacher/students">
            前往学生管理
          </Link>
        </div>
      ) : (
        <div className="roll-grid">
          <section className="panel roll-panel roll-panel-left">
            <div className="roll-panel-head">
              <h2>未点名</h2>
              <span>{pendingStudents.length}</span>
            </div>
            <div className="roll-name-grid">
              {pendingStudents.map((student) => (
                <button
                  key={student.id}
                  className="roll-name"
                  onClick={() => toggleStudent(student.id)}
                >
                  {student.name}
                </button>
              ))}
            </div>
          </section>

          <section className="panel roll-panel roll-panel-right">
            <div className="roll-panel-head">
              <h2>已点名</h2>
              <span>{calledStudents.length}</span>
            </div>
            {calledStudents.length === 0 ? (
              <p className="roll-empty">点击左侧姓名即可点到</p>
            ) : (
              <div className="roll-name-grid">
                {calledStudents.map((student) => (
                  <button
                    key={student.id}
                    className="roll-name roll-name-called"
                    onClick={() => toggleStudent(student.id)}
                  >
                    {student.name}
                  </button>
                ))}
              </div>
            )}
          </section>
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
