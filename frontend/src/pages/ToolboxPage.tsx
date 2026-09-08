import { Dices, LayoutGrid, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";

export default function ToolboxPage() {
  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="page-kicker">教学工具</p>
          <h1>工具箱</h1>
          <p>课堂里常用的小工具，数据来自本机学生名单</p>
        </div>
      </header>

      <div className="tool-grid">
        <Link className="tool-card" to="/tools/roll-call">
          <div className="tool-card-icon">
            <ListChecks size={28} />
          </div>
          <h2>点名</h2>
          <p>
            把全班姓名分成“未点名 / 已点名”两侧，点击姓名即可切换，适合课堂随机点人。
          </p>
        </Link>

        <Link className="tool-card" to="/tools/random-pick">
          <div className="tool-card-icon">
            <Dices size={28} />
          </div>
          <h2>随机点名</h2>
          <p>
            按班级随机抽一名同学，学号姓名大屏展示，可选不重复点名，适合课堂提问。
          </p>
        </Link>

        <Link className="tool-card" to="/tools/seating">
          <div className="tool-card-icon">
            <LayoutGrid size={28} />
          </div>
          <h2>座位表</h2>
          <p>
            自定义排数和列数，按名单顺序或一键随机安排座位，空位自动留在后排。
          </p>
        </Link>
      </div>

      <p className="tool-more-tip">更多工具箱功能正在开发中…</p>
    </div>
  );
}
