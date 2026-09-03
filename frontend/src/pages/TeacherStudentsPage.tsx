import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  addStudent,
  adjustStudentPoints,
  deleteStudent,
  getStudentPoints,
  importStudents,
  listStudents
} from "../api";
import type {
  Student,
  StudentImportResult,
  StudentPointsDetail,
  User
} from "../types";

interface TeacherStudentsPageProps {
  user: User;
  token: string | null;
}

export default function TeacherStudentsPage({
  user,
  token
}: TeacherStudentsPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [keyword, setKeyword] = useState("");
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<StudentImportResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newName, setNewName] = useState("");
  const [newStudentNo, setNewStudentNo] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newPoints, setNewPoints] = useState(0);

  const [selectedDetail, setSelectedDetail] = useState<StudentPointsDetail | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Student | null>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  async function reload() {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const data = await listStudents(token, { keyword, className });
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载学生失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [token, keyword, className]);

  async function handleImport() {
    if (!file || !token) {
      setError("请先选择 Excel 文件");
      return;
    }
    setError("");
    setImportResult(null);
    setSubmitting(true);
    try {
      const result = await importStudents(file, token);
      setImportResult(result);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddStudent() {
    if (!token) {
      return;
    }
    setError("");
    try {
      await addStudent(token, {
        name: newName,
        studentNo: newStudentNo,
        className: newClassName,
        initialPoints: newPoints
      });
      setNewName("");
      setNewStudentNo("");
      setNewClassName("");
      setNewPoints(0);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加学生失败");
    }
  }

  async function handleDelete(student: Student) {
    if (!token || !window.confirm(`确定删除 ${student.name} 吗？`)) {
      return;
    }
    try {
      await deleteStudent(token, student.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除学生失败");
    }
  }

  async function handleAdjustPoints() {
    if (!token || !adjustTarget) {
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
    if (!token) {
      return;
    }
    try {
      const detail = await getStudentPoints(token, student.id);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载积分明细失败");
    }
  }

  if (!token) {
    return <div className="page-content">登录状态已失效，请重新登录。</div>;
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">教学管理</p>
          <h1>学生积分</h1>
          <p>维护学生名单，查看和调整课堂积分</p>
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
          <a
            className="primary button-link"
            href="/api/v1/students/import/template"
          >
            下载模板
          </a>
        </div>
      </section>

      <section className="panel">
        <h2>导入学生</h2>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          className="primary"
          disabled={!file || submitting}
          onClick={handleImport}
        >
          {submitting ? "正在导入..." : "开始导入"}
        </button>

        {importResult && (
          <div className="import-result">
            <p>总行数：{importResult.total}</p>
            <p>成功：{importResult.success}</p>
            <p>失败：{importResult.failed}</p>
            {importResult.failed > 0 && (
              <table className="result-table">
                <thead>
                  <tr>
                    <th>Excel 行</th>
                    <th>姓名</th>
                    <th>学号</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.failures.map((failure) => (
                    <tr key={failure.rowNumber}>
                      <td>{failure.rowNumber}</td>
                      <td>{failure.name}</td>
                      <td>{failure.studentNo}</td>
                      <td>{failure.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>添加学生</h2>
        <div className="add-student-form">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="姓名"
          />
          <input
            value={newStudentNo}
            onChange={(event) => setNewStudentNo(event.target.value)}
            placeholder="学号"
          />
          <input
            value={newClassName}
            onChange={(event) => setNewClassName(event.target.value)}
            placeholder="班级"
          />
          <input
            type="number"
            value={newPoints}
            onChange={(event) => setNewPoints(Number(event.target.value))}
            placeholder="初始积分"
          />
          <button className="primary" onClick={handleAddStudent}>
            添加
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>学生列表</h2>
        {loading ? (
          <p>正在加载学生...</p>
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
                    <button onClick={() => handleDelete(student)}>删除</button>
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
