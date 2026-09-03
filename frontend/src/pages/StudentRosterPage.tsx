import { Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  addStudent,
  deleteStudent,
  importStudents,
  listStudentClasses,
  listStudents,
  updateStudent
} from "../api";
import type { Student, StudentImportResult } from "../types";

interface StudentRosterPageProps {
  token: string;
}

export default function StudentRosterPage({ token }: StudentRosterPageProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] =
    useState<StudentImportResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newName, setNewName] = useState("");
  const [newStudentNo, setNewStudentNo] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newPoints, setNewPoints] = useState(0);
  const [editTarget, setEditTarget] = useState<Student | null>(null);
  const [editName, setEditName] = useState("");
  const [editStudentNo, setEditStudentNo] = useState("");
  const [editClassName, setEditClassName] = useState("");
  const [editPoints, setEditPoints] = useState(0);

  async function reload() {
    setLoading(true);
    try {
      const result =
        selectedClass === "ALL"
          ? await listStudents(token)
          : await listStudents(token, { className: selectedClass });
      setStudents(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载学生名单失败");
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
  }, [token, selectedClass]);

  async function handleImport() {
    if (!file) {
      setError("请先选择 Excel 文件");
      return;
    }
    setError("");
    setImportResult(null);
    setSubmitting(true);
    try {
      const result = await importStudents(file, token);
      setImportResult(result);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await reloadClasses();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddStudent() {
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
      await reloadClasses();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加学生失败");
    }
  }

  async function handleDelete(student: Student) {
    if (!window.confirm(`确定删除 ${student.name} 吗？`)) {
      return;
    }
    try {
      await deleteStudent(token, student.id);
      await reloadClasses();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除学生失败");
    }
  }

  function openEdit(student: Student) {
    setEditTarget(student);
    setEditName(student.name);
    setEditStudentNo(student.studentNo);
    setEditClassName(student.className ?? "");
    setEditPoints(student.totalPoints);
  }

  async function handleUpdateStudent() {
    if (!editTarget) {
      return;
    }
    try {
      await updateStudent(token, editTarget.id, {
        name: editName,
        studentNo: editStudentNo,
        className: editClassName,
        totalPoints: editPoints
      });
      setEditTarget(null);
      await reloadClasses();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改学生失败");
    }
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">教学管理</p>
          <h1>学生管理</h1>
          <p>导入或添加学生，维护班级名单</p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <h2>导入学生</h2>
        <p className="panel-tip">
          请先下载模板，按「姓名 / 学号 / 班级 / 初始积分」填写后上传。
        </p>
        <div className="toolbar">
          <a
            className="secondary button-link"
            href="/api/v1/students/import/template"
          >
            <Download size={16} />
            下载模板
          </a>
          <label className="secondary file-picker">
            <Upload size={16} />
            {file ? "重新选择文件" : "选择 Excel 文件"}
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {file && <span className="file-name">{file.name}</span>}
          <button
            className="primary"
            disabled={!file || submitting}
            onClick={handleImport}
          >
            {submitting ? "正在导入..." : "开始导入"}
          </button>
        </div>

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
        <h2>学生名单</h2>
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
          <p className="panel-empty">还没有学生，请先导入或添加。</p>
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
                    <button onClick={() => openEdit(student)}>修改</button>
                    <button onClick={() => handleDelete(student)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editTarget && (
        <div className="modal-mask">
          <div className="modal-card">
            <h2>修改学生</h2>
            <label>
              姓名
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <label>
              学号
              <input
                value={editStudentNo}
                onChange={(event) => setEditStudentNo(event.target.value)}
              />
            </label>
            <label>
              班级
              <input
                value={editClassName}
                onChange={(event) => setEditClassName(event.target.value)}
              />
            </label>
            <label>
              积分
              <input
                type="number"
                value={editPoints}
                onChange={(event) => setEditPoints(Number(event.target.value))}
              />
            </label>
            <button className="primary" onClick={handleUpdateStudent}>
              保存
            </button>
            <button onClick={() => setEditTarget(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="page-footer-actions">
        <Link className="secondary button-link" to="/teacher/points">
          前往学生积分
        </Link>
      </div>
    </div>
  );
}
