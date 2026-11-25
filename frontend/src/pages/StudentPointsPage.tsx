import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  adjustStudentPoints,
  exportStudentsFile,
  getStudentPoints,
  listStudentClasses,
  listStudents
} from "../api";
import { useTranslation } from "../i18n";
import type {
  Student,
  StudentPointsDetail,
  StudentPointsLedger
} from "../types";

type SortKey = "name" | "studentNo" | "className" | "totalPoints";
type SortDirection = "asc" | "desc";

interface StudentPointsPageProps {
  token: string;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  GAME_EARN: "游戏得分",
  MANUAL_EARN: "手动加分",
  MANUAL_DEDUCT: "手动扣分",
  INIT: "初始积分"
};

const CHANGE_TYPE_CLASS: Record<string, string> = {
  GAME_EARN: "ledger-type-game",
  MANUAL_EARN: "ledger-type-earn",
  MANUAL_DEDUCT: "ledger-type-deduct",
  INIT: "ledger-type-init"
};

function ledgerTypeLabel(changeType: string): string {
  return CHANGE_TYPE_LABELS[changeType] ?? changeType;
}

function ledgerReason(item: StudentPointsLedger): string {
  if (item.changeType === "GAME_EARN") {
    return item.gameName ?? "游戏得分";
  }
  if (item.changeType === "MANUAL_EARN" || item.changeType === "MANUAL_DEDUCT") {
    return item.bizType === "MANUAL_ADJUST" ? "手动调整" : item.bizType;
  }
  if (item.changeType === "INIT") {
    return item.bizType === "STUDENT_IMPORT" ? "导入学生" : "初始积分";
  }
  return item.bizType;
}

export default function StudentPointsPage({ token }: StudentPointsPageProps) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [selectedDetail, setSelectedDetail] =
    useState<StudentPointsDetail | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Student | null>(null);
  // 字符串态：数字态下清空输入框等于填 0，而这里提交 0 会写一条无意义的
  // 积分流水（还可能是 MANUAL_DEDUCT），必须让「空」和「0」区分开。
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const requestSeqRef = useRef(0);

  async function reload() {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoading(true);
    try {
      const filters =
        selectedClass === "ALL"
          ? { keyword }
          : { keyword, className: selectedClass };
      const result = await listStudents(token, filters);
      if (seq !== requestSeqRef.current) {
        return;
      }
      setStudents(result);
      setError("");
    } catch (err) {
      if (seq !== requestSeqRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "加载学生失败");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
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
    if (adjustAmount.trim() === "") {
      setError("请填写积分变动值（加分为正数，扣分为负数）");
      return;
    }
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount === 0) {
      setError("积分变动必须是≠0 的整数");
      return;
    }
    setError("");
    try {
      await adjustStudentPoints(token, adjustTarget.id, {
        amount,
        reason: adjustReason
      });
      setAdjustTarget(null);
      setAdjustAmount("");
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

  function handleSearch() {
    setKeyword(searchText.trim());
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">{t("pages.points.kicker")}</p>
          <h1>{t("pages.points.title")}</h1>
          <p>{t("pages.points.subtitle")}</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <div className="toolbar">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSearch();
              }
            }}
            placeholder="搜索姓名或学号"
          />
          <button
            className="secondary toolbar-action"
            onClick={handleSearch}
          >
            搜索
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>积分列表</h2>
          <button
            className="secondary toolbar-action"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download size={16} />
            {exporting ? "正在导出..." : "导出 Excel"}
          </button>
        </div>
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
                    <button
                      onClick={() => {
                        setAdjustTarget(student);
                        setAdjustAmount("");
                        setAdjustReason("");
                      }}
                    >
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
                onChange={(event) => setAdjustAmount(event.target.value)}
                placeholder="加分填正数，扣分填负数"
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
                  <th>原因 / 来源</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetail.ledger.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span
                        className={`ledger-type-badge ${
                          CHANGE_TYPE_CLASS[item.changeType] ??
                          "ledger-type-other"
                        }`}
                      >
                        {ledgerTypeLabel(item.changeType)}
                      </span>
                    </td>
                    <td>{item.amount > 0 ? `+${item.amount}` : item.amount}</td>
                    <td>{item.balanceAfter}</td>
                    <td>{ledgerReason(item)}</td>
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
