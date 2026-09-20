import { Link } from "react-router-dom";
import { useRandomPick } from "../hooks/useRandomPick";
import { useTranslation } from "../i18n";

interface RandomPickPageProps {
  token: string;
}

export default function RandomPickPage({ token }: RandomPickPageProps) {
  const { t } = useTranslation();
  const {
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
  } = useRandomPick(token);

  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">{t("pages.randompick.kicker")}</p>
          <h1>{t("pages.randompick.title")}</h1>
          <p>{t("pages.randompick.subtitle")}</p>
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
            onClick={() => selectClass("ALL")}
          >
            全部班级
          </button>
          {classList.map((className) => (
            <button
              key={className}
              className={selectedClass === className ? "active" : ""}
              onClick={() => selectClass(className)}
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
