/**
 * 悬浮球打包产物自检：直接从 app.asar 里取 ball.html / main.js，核对几条
 * 「视觉/尺寸」铁律有没有真的进包。纯读取，不修改任何文件。
 *
 * 用法：
 *   node scripts/verify-ball-build.js [app.asar 路径 ...]
 *   不传参数时检查三份默认产物。
 */
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const targets = process.argv.slice(2);
const defaults = [
  path.join(__dirname, "..", "release", "win-unpacked", "resources", "app.asar"),
  path.join(__dirname, "..", "release-portable", "EduPlay-便携版", "resources", "app.asar"),
  path.join(__dirname, "..", "release-portable-32", "EduPlay-便携版-32", "resources", "app.asar")
];

const checks = [
  ["ball.html 无方形阴影声明", (h) => !/box-shadow\s*:\s*0\s+4px\s+12px/.test(h.match(/<style>[\s\S]*?<\/style>/)[0])],
  ["ball.html 无白色圆底", (h) => !/background\s*:\s*#ffffff/i.test(h.match(/<style>[\s\S]*?<\/style>/)[0])],
  ["ball.html 球体尺寸写死 56px", (h) => /width:\s*56px;\s*height:\s*56px/.test(h)],
  ["ball.html 不再用 100% 撑满窗口", (h) => !/#ball\s*\{[^}]*width:\s*100%/s.test(h)],
  ["ball.html 已拦截滚轮缩放", (h) => h.includes('addEventListener("wheel"')],
  ["ball.html 有视口尺寸日志", (h) => h.includes("BALL-VIEWPORT")]
];

function verifyMain(js) {
  return [
    ["window 透明底色 + 无系统阴影", () => js.includes('backgroundColor: "#00000000"') || js.includes('backgroundColor: "#00000000",')],
    ["thickFrame:false（去 DWM 阴影）", () => js.includes("thickFrame: false")],
    ["useContentSize:true", () => js.includes("useContentSize: true")],
    ["min/max 尺寸锁 56×56", () => js.includes("minWidth: DEFAULT_BALL_SIZE") && js.includes("hasShadow: false")],
    ["hide() 后补尺寸（#41063 兜底）", () => js.includes('ensureBallSize("after-hide")')],
    ["尺寸守卫 watchdog 存在", () => js.includes("function startBallSizeGuard")],
    ["webPreferences.zoomFactor 固定为 1", () => /zoomFactor:\s*1/.test(js)]
  ];
}

const list = targets.length ? targets : defaults;
let failed = 0;
for (const file of list) {
  console.log("\n=== " + file);
  if (!fs.existsSync(file)) {
    console.log("  跳过：文件不存在");
    continue;
  }
  const html = asar.extractFile(file, "ball.html").toString("utf8");
  const main = asar.extractFile(file, "main.js").toString("utf8");
  for (const [name, fn] of checks) {
    const ok = fn(html);
    if (!ok) failed++;
    console.log(`  ${ok ? "OK  " : "失败"} ${name}`);
  }
  for (const [name, fn] of verifyMain(main)) {
    const ok = fn();
    if (!ok) failed++;
    console.log(`  ${ok ? "OK  " : "失败"} ${name}`);
  }
}
console.log(failed === 0 ? "\n全部通过" : `\n有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
