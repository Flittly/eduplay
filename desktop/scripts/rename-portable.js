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
if (!pkg.portableDirName) {
  console.error('[portable] package.json 缺少顶层字段 "portableDirName"，无法确定输出目录名');
  process.exit(1);
}

// --arch <x64|ia32>：目标架构，默认 x64。**不带参数时行为与改造前完全一致。**
//
// 为什么必须参数化：electron-builder 的 --dir 产物目录名由架构决定，见
//   app-builder-lib/out/platformPackager.js -> computeAppOutDir()
// 它用 getArchSuffix(arch, defaultArch) 拼出 `${platform}-${arch}-unpacked`，
// 而 x64 是默认架构、后缀为空 —— 所以：
//   x64  → win-unpacked
//   ia32 → win-ia32-unpacked
// 旧版把 "win-unpacked" 写死，一换架构就会在**打包流程的最后一步**才报
// 「未找到构建产物」，前面几分钟全部白跑。
let arch = "x64";
const archIdx = process.argv.indexOf("--arch");
if (archIdx !== -1 && process.argv[archIdx + 1]) {
  arch = process.argv[archIdx + 1];
}
const isX86 = arch === "ia32";
const unpackedName = isX86 ? "win-ia32-unpacked" : "win-unpacked";

// 交付根目录与程序目录名都带架构后缀，两版可以在同一台机器上各自构建、互不覆盖。
// （U 盘上的**数据目录名仍然共用** —— 那是刻意共享的，见 main.js 顶部说明。）
const defaultDeliveryRootName = isX86 ? "release-portable-32" : "release-portable";
const targetName = isX86 ? `${pkg.portableDirName}-32` : pkg.portableDirName;
// 数据目录名的唯一真源，与 main.js 读的是同一个字段。
// 写死在这里的后果我们踩过一次：改名后日志还印着旧名字，误导人。
const dataDirName = pkg.portableDataDirName;
if (!dataDirName) {
  console.error('[portable] package.json 缺少顶层字段 "portableDataDirName"');
  process.exit(1);
}

// --from <目录>：构建输出根目录。默认与交付目录相同。
let buildRootName = defaultDeliveryRootName;
const fromIdx = process.argv.indexOf("--from");
if (fromIdx !== -1 && process.argv[fromIdx + 1]) {
  buildRootName = process.argv[fromIdx + 1];
}

const deliveryRoot = path.join(desktopDir, defaultDeliveryRootName);
const buildRoot = path.isAbsolute(buildRootName) ? buildRootName : path.join(desktopDir, buildRootName);
const builtDir = path.join(buildRoot, unpackedName);
const finalDir = path.join(deliveryRoot, targetName);

if (!fs.existsSync(builtDir)) {
  console.error(`[portable] 未找到构建产物：${builtDir}`);
  console.error("           请先运行 electron-builder --win dir");
  process.exit(1);
}

/**
 * 读 PE 文件头的 Machine 字段，用来**机器可验**地判定真实位数。
 *   0x14c  = i386（32 位）
 *   0x8664 = x64 （64 位）
 * 为什么不看文件名/目录名：那些都是我们自己起的，说它 32 位它就"是"32 位。
 * 只有 PE 头能回答"这个 exe 到底能不能在 32 位系统上跑"。
 */
function readPeMachine(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const dos = Buffer.alloc(0x40);
      fs.readSync(fd, dos, 0, 0x40, 0);
      if (dos.toString("latin1", 0, 2) !== "MZ") return null;
      const peOffset = dos.readUInt32LE(0x3c);
      const head = Buffer.alloc(6);
      fs.readSync(fd, head, 0, 6, peOffset);
      if (head.toString("latin1", 0, 2) !== "PE") return null;
      return head.readUInt16LE(4);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
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
  console.log(`[portable] 已写入 portable.txt（数据将保存在本目录同级的 ${dataDirName} 下）`);
} else {
  console.warn(`[portable] 警告：标记文件模板不存在，未写入 portable.txt -> ${markerSource}`);
}

// U 盘根目录的使用说明。
//
// 单独放一份而不是只靠数据目录里的说明：老师是先看到 U 盘上并排的两个文件夹、
// 心里犯嘀咕，才会有后面的事。说明要在他动手之前就摆在旁边。
// 内容用纯文本、用词口语化，避免任何 Markdown 记号（这是给人双击打开的 .txt）。
const readmePath = path.join(deliveryRoot, "使用说明.txt");
try {
  fs.writeFileSync(
    readmePath,
    [
      "EduPlay 使用说明",
      "",
      "这个 U 盘上有两个文件夹，各自的分工是：",
      "",
      `  ${targetName}`,
      "      —— 程序本体。双击里面的 EduPlay.exe 启动。",
      "",
      `  ${dataDirName}`,
      "      —— 您的数据。班级名单、学生成绩、积分、已安装的游戏、",
      "         登录状态和界面设置，全部存在这里。",
      "",
      "重要：第二个文件夹请不要删除。“请勿删除”不是客套话 ——",
      "删掉它，班级和学生数据就全部没有了，无法找回。",
      "",
      "以后要升级到新版本时：",
      "",
      "  1. 先在程序里正常退出（不要直接拔 U 盘）；",
      `  2. 把「${targetName}」这个文件夹整个换成新版本的同名文件夹；`,
      `  3. 「${dataDirName}」一动都不要动。`,
      "",
      "换上新版本后数据会自动沿用，数据库结构也会自动升级，",
      "不需要导出再导入，班级和学生一个都不会少。",
      ""
    ].join("\r\n"),
    "utf8"
  );
  console.log("[portable] 已写入 使用说明.txt（放在交付根目录，与程序文件夹并列）");
} catch (err) {
  console.warn(`[portable] 使用说明.txt 写入失败（${err.code}），交付前需补上：${readmePath}`);
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

// 架构自检（仅 32 位构建）：确认 exe 与内嵌 JRE 真的是 i386。
// 32 位产物里混进 64 位文件，在 64 位 Windows 上照样能跑（WoW64），
// 只有拿到真正的 32 位机器上才会炸 —— 所以必须在交付前用 PE 头卡住。
if (isX86) {
  for (const rel of [`${productName}.exe`, path.join("resources", "jre", "bin", "java.exe")]) {
    const full = path.join(finalDir, rel);
    const machine = fs.existsSync(full) ? readPeMachine(full) : null;
    const ok = machine === 0x14c;
    if (!ok) missing++;
    const shown = machine === null ? "读不到" : `0x${machine.toString(16)}`;
    console.log(`[portable] ${ok ? "OK  " : "错架"} ${rel} PE=${shown}${ok ? " (i386)" : "（应为 i386 = 0x14c）"}`);
  }
}

// 交付目录里绝不该出现数据目录 —— 那说明它是从别处误拷来的，
// 或者上一轮跑过程序。早报比让老师拿到一份带数据的"新版本"好。
for (const stray of [dataDirName, "EduPlayData", "userdata"]) {
  if (fs.existsSync(path.join(finalDir, stray))) {
    missing++;
    console.error(`[portable] 交付目录里混入了数据目录：${stray}（必须删掉再交付）`);
  } else if (fs.existsSync(path.join(deliveryRoot, stray))) {
    // 交付根目录就是"U 盘根目录"的等价物，说明文件也放在这里。
    // 这里的残留不会被拷进程序文件夹，但交付时容易被整份复制走。
    console.warn(`[portable] 提醒：${deliveryRoot} 下有残留的 ${stray}，交付前请删掉`);
  }
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
console.log(`交付：把 "${targetName}" 文件夹和 "使用说明.txt" 一起拷到 U 盘根目录。`);
console.log(`      首次运行后，数据会创建在它旁边，即同级的 "${dataDirName}" 文件夹。`);
console.log(`      以后更新只需替换 "${targetName}"，数据文件夹保持不动。`);
