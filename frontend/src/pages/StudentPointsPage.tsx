import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  adjustStudentPoints,
  exportStudentsFile,
  getStudentPoints,
  listStudents
} from "../api";
import type { Student, StudentPointsDetail } from "../types";

interface StudentPointsPageProps {
  token: string;
}

export default function StudentPointsPage({ token }: StudentPointsPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [keyword, setKeyword] = useState("");
  const [className, setClassName] = useState("");
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
      setStudents(await listStudents(token, { keyword, className }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载学生失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [token, keyword, className]);

  async function handleExport() {
    setExporting(true);
    setError("");
    try {
      await exportStudentsFile(token, { keyword, className });
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
          <input
            value={className}
            onChange={(event) => setClassName(event.target.value)}
            placeholder="按班级筛选"
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
                <th>姓名</th>
                <th>学号</th>
                <th>班级</th>
                <th>积分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
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

      <div>
        <Link to="/">返回游戏中心</Link>
      </div>
    </div>
  );
}
