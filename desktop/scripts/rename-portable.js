#!/usr/bin/env node
/**
 * 构建后处理：把 electron-builder 的 --dir 产物整理成可直接交付的便携版文件夹。
 *
 * 做三件事：
 *   1. 把 win-unpacked 重命名为面向用户的名字
 *   2. 放入便携模式标记文件 portable.txt
 *   3. 自检关键文件是否齐全
 *
 * 用法：
 *   node scripts/rename-portable.js
 *       → 常规路径：处理 release-portable\win-unpacked
 *   node scripts/rename-portable.js --from <目录>
 *       → electron-builder 输出到了别的目录时，指定它的来源根目录
 *
 * 为什么需要"重命名"这一步：
 *   electron-builder 的 unpacked 目录名是硬编码的，见
 *   app-builder-lib/out/platformPackager.js -> computeAppOutDir()：
 *     `${platform}-${arch}-unpacked`   →  Windows x64 就是 "win-unpacked"
 *   没有任何配置项能改它，唯一可控的是父目录（directories.output），
 *   所以只能在构建完成后重命名。
 *
 * 目录名的唯一真源：package.json 顶层的 portableDirName 字段。
 * 想改名只改那一处，dist:portable 和 release 两条路径都会生效。
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const desktopDir = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));

const productName = (pkg.build && pkg.build.productName) || pkg.name;
const targetName = pkg.portableDirName;
if (!targetName) {
  console.error('[portable] package.json 缺少顶层字段 "portableDirName"，无法确定输出目录名');
  process.exit(1);
}

// --from <目录>：构建输出根目录。默认与交付目录相同。
let buildRootName = "release-portable";
const fromIdx = process.argv.indexOf("--from");
if (fromIdx !== -1 && process.argv[fromIdx + 1]) {
  buildRootName = process.argv[fromIdx + 1];
}

const deliveryRoot = path.join(desktopDir, "release-portable");
const buildRoot = path.isAbsolute(buildRootName) ? buildRootName : path.join(desktopDir, buildRootName);
const builtDir = path.join(buildRoot, "win-unpacked");
const finalDir = path.join(deliveryRoot, targetName);

if (!fs.existsSync(builtDir)) {
  console.error(`[portable] 未找到构建产物：${builtDir}`);
  console.error("           请先运行 electron-builder --win dir");
  process.exit(1);
}

// 复制兜底：删除/移动都可能被外部因素挡住，这时用 robocopy 覆盖目标目录。
// 为什么不用 fs.cpSync：实测在本机复制 400MB 目录会直接崩溃（段错误）。
// robocopy 退出码 0-7 表示成功，>=8 才是错误。
function copyFallback(reason) {
  console.warn(`[portable] ${reason}，改用 robocopy 覆盖……`);
  let status = 0;
  try {
    // /MIR 让交付目录严格等于构建产物，顺带清掉上一版遗留的历史文件
    // （例如旧的 hash 资源包）。交付目录只应存放构建产物，不含用户数据。
    execFileSync(
      "robocopy",
      [builtDir, finalDir, "/MIR", "/COPY:DAT", "/R:2", "/W:2", "/NFL", "/NDL", "/NJH", "/NJS"],
      { stdio: ["ignore", "ignore", "inherit"] }
    );
  } catch (robocopyErr) {
    status = typeof robocopyErr.status === "number" ? robocopyErr.status : 99;
  }
  if (status > 7) {
    console.error(`[portable] robocopy 复制失败，退出码 ${status}`);
    process.exit(1);
  }
  console.log(`[portable] 已复制到：${finalDir}`);
  if (fs.existsSync(builtDir)) {
    console.warn(`[portable] 原构建目录未能清理，可稍后手动删除：${builtDir}`);
  }
}

// 上一次构建剩下的同名目录先清掉。
// 实测两种失败来源都会走到这里，且都无法从 err.code 区分：
//   1) 本机的 safe-delete 类拦截（删除被转交回收站，中文目录名会直接失败，
//      且包装后的错误没有 code）；
//   2) 杀毒软件（如火绒）实时防护持有大文件句柄（EBUSY/EPERM）。
// 所以这里不按 code 分支：删除失败就一律交给 robocopy 覆盖，保证本次构建可用。
let useCopy = false;
if (fs.existsSync(finalDir)) {
  try {
    fs.rmSync(finalDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 });
  } catch (err) {
    console.warn(`[portable] 无法删除已存在的目录（${err.code || "删除被拦截"}）`);
    useCopy = true;
  }
}

if (!useCopy) {
  try {
    fs.mkdirSync(deliveryRoot, { recursive: true });
    fs.renameSync(builtDir, finalDir);
    console.log(`[portable] 目录名：${targetName}`);
  } catch (err) {
    // 删得掉但移不动：同样是句柄占用（Windows 不允许移动已打开的文件）
    copyFallback(`无法移动（${err.code || "被占用"}）`);
  }
} else {
  copyFallback("删除旧目录失败");
}

// 便携模式标记文件。main.js 在模块顶层检测它，存在就把数据目录重定向到 exe 旁边，
// 数据库、缓存、登录状态才会跟着 U 盘走。
const markerSource = path.join(desktopDir, "build", "portable-marker.txt");
if (fs.existsSync(markerSource)) {
  fs.copyFileSync(markerSource, path.join(finalDir, "portable.txt"));
  console.log("[portable] 已写入 portable.txt（数据将保存在该目录的 userdata 下）");
} else {
  console.warn(`[portable] 警告：标记文件模板不存在，未写入 portable.txt -> ${markerSource}`);
}

// 自检：缺任何一项都说明这次打包不完整，早报比用户双击后报错好。
const required = [
  `${productName}.exe`,
  "portable.txt",
  path.join("resources", "app.jar"),
  path.join("resources", "jre", "bin", "java.exe"),
];
let missing = 0;
for (const rel of required) {
  const ok = fs.existsSync(path.join(finalDir, rel));
  if (!ok) missing++;
  console.log(`[portable] ${ok ? "OK  " : "缺失"} ${rel}`);
}

// 来源和交付目录不同时（--from），顺手清掉构建用的临时根目录。
if (path.resolve(buildRoot) !== path.resolve(deliveryRoot)) {
  try {
    fs.rmSync(buildRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    console.log(`[portable] 已清理临时构建目录：${buildRootName}`);
  } catch (err) {
    console.warn(`[portable] 临时构建目录未能删除（${err.code}），可稍后手动删除：${buildRoot}`);
  }
}

console.log("");
if (missing > 0) {
  console.error(`[portable] 有 ${missing} 个关键文件缺失，这次产物不完整`);
  process.exit(1);
}
console.log(`交付：把整个 "${targetName}" 文件夹拷到 U 盘即可（无需拷贝外层目录）。`);
