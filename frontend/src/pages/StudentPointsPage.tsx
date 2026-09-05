import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  adjustStudentPoints,
  exportStudentsFile,
  getStudentPoints,
  listStudentClasses,
  listStudents
} from "../api";
import type { Student, StudentPointsDetail } from "../types";

type SortKey = "name" | "studentNo" | "className" | "totalPoints";
type SortDirection = "asc" | "desc";

interface StudentPointsPageProps {
  token: string;
}

export default function StudentPointsPage({ token }: StudentPointsPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [selectedDetail, setSelectedDetail] =
    useState<StudentPointsDetail | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Student | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const filters =
        selectedClass === "ALL"
          ? { keyword }
          : { keyword, className: selectedClass };
      setStudents(await listStudents(token, filters));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载学生失败");
    } finally {
      setLoading(false);
    }
  }

  async function reloadClasses() {
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
    void reloadClasses();
    void reload();
  }, [token, keyword, selectedClass]);

  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      const filters =
        selectedClass === "ALL"
          ? { keyword }
          : { keyword, className: selectedClass };
      await exportStudentsFile(token, filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function handleAdjustPoints() {
    if (!adjustTarget) {
      return;
    }
    try {
      await adjustStudentPoints(token, adjustTarget.id, {
        amount: adjustAmount,
        reason: adjustReason
      });
      setAdjustTarget(null);
      setAdjustAmount(0);
      setAdjustReason("");
      await reload();
      if (selectedDetail?.student.id === adjustTarget.id) {
        const detail = await getStudentPoints(token, adjustTarget.id);
        setSelectedDetail(detail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改积分失败");
    }
  }

  async function handleShowDetail(student: Student) {
    try {
      const detail = await getStudentPoints(token, student.id);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载积分明细失败");
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const sortedStudents = [...students];
  if (sortKey) {
    const direction = sortDirection === "asc" ? 1 : -1;
    sortedStudents.sort((a, b) => {
      if (sortKey === "totalPoints") {
        return (a.totalPoints - b.totalPoints) * direction;
      }
      const left = (a[sortKey] ?? "").toString();
      const right = (b[sortKey] ?? "").toString();
      return (
        left.localeCompare(right, "zh-CN", {
          numeric: true,
          sensitivity: "base"
        }) * direction
      );
    });
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) {
      return " ↕";
    }
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">教学管理</p>
          <h1>学生积分</h1>
          <p>查看学生积分，手动增加或扣减课堂积分</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <div className="toolbar">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索姓名或学号"
          />
          <button
            className="secondary toolbar-action"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download size={16} />
            {exporting ? "正在导出..." : "导出 Excel"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>积分列表</h2>
        <div className="class-tabs">
          <button
            className={selectedClass === "ALL" ? "active" : ""}
            onClick={() => setSelectedClass("ALL")}
          >
            全部
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
        {loading ? (
          <p>正在加载学生...</p>
        ) : students.length === 0 ? (
          <p className="panel-empty">
            暂无学生数据，请先到「学生管理」导入或添加学生。
          </p>
        ) : (
          <table className="result-table">
            <thead>
              <tr>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("name")}
                  >
                    姓名{sortIndicator("name")}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("studentNo")}
                  >
                    学号{sortIndicator("studentNo")}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("className")}
                  >
                    班级{sortIndicator("className")}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("totalPoints")}
                  >
                    积分{sortIndicator("totalPoints")}
                  </button>
                </th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student) => (
                <tr key={student.id}>
                  <td>{student.name}</td>
                  <td>{student.studentNo}</td>
                  <td>{student.className ?? "-"}</td>
                  <td>{student.totalPoints}</td>
                  <td>
                    <button onClick={() => handleShowDetail(student)}>
                      明细
                    </button>
                    <button onClick={() => setAdjustTarget(student)}>
                      改积分
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {adjustTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>调整 {adjustTarget.name} 的积分</h2>
            <label>
              积分变动
              <input
                type="number"
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(Number(event.target.value))}
              />
            </label>
            <label>
              原因
              <input
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
                placeholder="例如：课堂表现"
              />
            </label>
            <button className="primary" onClick={handleAdjustPoints}>
              确认
            </button>
            <button onClick={() => setAdjustTarget(null)}>取消</button>
          </div>
        </div>
      )}

      {selectedDetail && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>{selectedDetail.student.name} 的积分明细</h2>
            <p>当前积分：{selectedDetail.student.totalPoints}</p>
            <table className="result-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>变动</th>
                  <th>变动后</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetail.ledger.map((item) => (
                  <tr key={item.id}>
                    <td>{item.changeType}</td>
                    <td>{item.amount > 0 ? `+${item.amount}` : item.amount}</td>
                    <td>{item.balanceAfter}</td>
                    <td>{item.bizType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setSelectedDetail(null)}>关闭</button>
          </div>
        </div>
      )}

      <div className="page-footer-actions">
        <Link className="secondary button-link" to="/">
          返回游戏中心
        </Link>
      </div>
    </div>
  );
}
