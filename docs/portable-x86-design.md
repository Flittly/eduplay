# EduPlay 32 位便携版——可行性论证与设计方案

> 状态：**已实施（2026-10-11）**　目标版本：EduPlay 1.5.1
> 所有结论均在本机实测或从已安装依赖的源码中读出，文末附复现命令。
>
> **实施记录**：见文末 §10。本文是设计稿，落地时有**两处刻意偏离**，以 §10 为准：
> ① 命名统一用 `-32` 后缀（`runtime-32` / `electron-builder-32.yml` / `release-portable-32` /
> `EduPlay-便携版-32`），不再用 `x86`；
> ② 未新增 `portableDirNameX86` 字段 —— 目录名由 `rename-portable.js --arch ia32`
> 从 `portableDirName` 推导，少一处「版本/名称真源」。

---

## 0. 先回答：现在有哪几个平台产物？

有，**安装版和便携版两个都在**，但目前**都是 64 位（x64）**，没有任何 32 位产物。

| 产物 | 路径 | 体积 | 形态 |
|---|---|---|---|
| 安装版（NSIS） | `desktop/release/EduPlay Setup 1.5.1.exe` | 165 MB | 安装包，数据在 `%APPDATA%` |
| 安装版（整包 zip） | `desktop/release/EduPlay Setup 1.5.1.zip` | 165 MB | 免安装压缩包 |
| 便携版（目录） | `desktop/release-portable/EduPlay-便携版/` | 402 MB | 绿色目录，内含 `portable.txt` |
| 便携版（分发 zip） | `desktop/release-portable/EduPlay-便携版.zip` | 199 MB | |
| 便携版数据目录 | `desktop/release-portable/EduPlay-用户数据（请勿删除）/` | 11 MB | 与程序目录**并列** |

---

## 1. 一句话结论

**能做的，但只有一条窄缝，而且这条缝在 2027 年 1 月会关上。**

- **车壳（Electron）**：32 位构建（`win32-ia32`）**停在 Electron 43**。官方明确 v44 起只发 64 位，v43 于 2027-01 结束支持。项目现用 36.9.5，恰好还在窗口内。
- **发动机（JRE 21）**：OpenJDK 官方已砍掉 Windows 32 位端口（JEP 479 在 JDK 23 移除、JEP 503 在 JDK 25 清完），**Adoptium 自 2026 年起也停止发布 win32**。目前唯一还在供货的是 **BellSoft Liberica**（包名带 `i586`）。
- **车里装的货（后端 jar）**：纯 Java，无任何 native / JNI 依赖，与架构无关。

所以：**技术上可行，但配件供应链已经在收摊。** 建议把 32 位版定位成「老旧机房的兜底交付」，不要当长期并行主线。

### 生活类比

| 层 | 类比 | 现状 |
|---|---|---|
| Electron 壳 | 车壳供应商 | "这款壳卖到 2027 年 1 月截止" |
| JRE 21 | 发动机 | 大厂全停产 32 位型号，只剩一家小厂还在接单 |
| 后端 jar | 车里装的货 | 纯软件，不看机型，谁拉都行 |

车还能开，但**以后买不到配件了**。

---

## 2. 三层栈的 32 位可得性（实测）

| 层 | 组件 | 32 位可得性 | 依据 |
|---|---|---|---|
| 壳 | Electron | ⚠️ 只能 ≤ 43 | Electron 44 起只发 64 位；43 是最后一代，2027-01 EOL |
| 壳 | electron-v36.9.5-win32-ia32.zip | ✅ 可得 | npmmirror 镜像 HTTP 200（项目现用版本即可） |
| 运行时 | BellSoft Liberica JDK 21 `i586` | ✅ 可得 | `bellsoft-jdk21.0.12+10-windows-i586`，202 MB，官方 CDN 直下 |
| 运行时 | Adoptium Temurin JDK 21 x86 | ❌ 不可得 | 查询返回空；官方 2026 起停发 win32 |
| 后端 | Spring Boot 4.1.1 jar | ✅ 无限制 | 依赖仅 H2 / POI / Flyway / Spring，无 native 库 |

---

## 3. 实测证据清单（本机已跑通）

| 验证项 | 结果 |
|---|---|
| 32 位 JDK 21 下载 | ✅ 202,886,851 字节，BellSoft CDN `HTTP 200`（GitHub 直链在本网络被拦，需走 CDN） |
| 它是不是**真** 32 位 | ✅ `java -version` → `OpenJDK **32-Bit Client VM**`；PE 头机器码 `0x14c = i386` |
| jlink 能否产出 32 位裁剪运行时 | ✅ 79 MB（现有 64 位 runtime 是 80 MB，体积基本一致） |
| 32 位运行时能否跑起后端 jar | ✅ **9 秒就绪**，`/api/v1/health` 返回 `status: UP` |
| Flyway 数据库迁移 | ✅ 14 条迁移全部成功，`now at version v14` |
| H2 落库 | ✅ 生成 `eduplay.mv.db`（61 KB，含新写入数据） |
| 真实读写（注册 + 登录） | ✅ 返回 token，`user.id=2 / role=TEACHER` |
| 前端静态资源 | ✅ `index.html` 200、`assets/index-D2n6_mvj.js` 正常 |
| **结论** | **32 位后端链路已完整验证可用** |

---

## 4. 三个必须提前知道的坑

### 坑 1：32 位 JVM 默认最大堆只有 256 MB

`-XX:+PrintFlagsFinal` 实测：

```
size_t InitialHeapSize  =  16777216   (16 MB)
size_t MaxHeapSize      = 268435456   (256 MB)   ← 默认上限
```

Spring Boot + H2 在轻载下能跑（上面已实测），但**必须显式给 `-Xmx`**，否则负载一高就有 OOM 风险，而且报错是 `OutOfMemoryError`，用户看到的现象是"程序突然没了"。

- 建议：`-Xms64m -Xmx768m`
- 红线：32 位进程用户地址空间约 2 GB，**堆不要超过 1 GB**。

### 坑 2：32 位 Windows JVM 默认是 Client VM（只有 C1，没有 C2）

`lib/jvm.cfg` 内容为 `-client KNOWN` / `-server KNOWN`，且 `bin/client/jvm.dll` 与 `bin/server/jvm.dll` **都在**。
⇒ 可以显式加 **`-server`** 启用 C2 服务端 JIT。实测加 `-server` 后启动仍 9 秒、功能正常。

（不加也能跑，差距在长时间计算密集场景才明显；我们的后端以 IO/DB 为主，属于"加了更稳"而非"必加"。）

### 坑 3：打包输出目录名会变，现有脚本会**直接失败**

本机 `app-builder-lib/out/platformPackager.js:93` 的真实逻辑：

```js
path.join(outDir, `${this.platform.buildConfigurationKey}${getArchSuffix(arch, defaultArch)}-unpacked`)
```

而 `builder-util/out/arch.js:36`：

```js
function getArchSuffix(arch, defaultArch) {
    return arch === defaultArchFromString(defaultArch) ? "" : `-${Arch[arch]}`;
}
```

⇒ x64 是默认架构，后缀为空 → `win-unpacked`；**`--ia32` 会产出 `win-ia32-unpacked`**。

`scripts/rename-portable.js:57` 写死了 `path.join(buildRoot, "win-unpacked")`，不改就报
「未找到构建产物」，且**失败点在打包最后一步**，前面几分钟全白跑。

### 坑 3b（附带发现）：`--config` 会**完全忽略** `package.json` 的 `build` 段

`app-builder-lib/out/util/config/load.js:82`：

```js
function getConfig(request, configPath) {
    if (configPath == null) {
        return loadConfig(request);          // ← 只有这条分支才读 package.json 的 build
    }
    else {
        return readConfig(path.resolve(request.projectDir, configPath), request);
    }
}
```

⇒ 一旦给 `--config xxx.yml`，`files` / `extraResources` / `win` / `nsis` / `icon` / `electronLanguages`
**全部失效**，x86 的配置文件必须是**完整的一份**，不能只写差异项。（`readConfig` 里没有与 package.json 的合并。）

---

## 5. 改动清单（before → after）

核心思路：**x64 那条链一个字不动**，32 位另起一条平行链。

### 5.1 `desktop/scripts/make-runtime.ps1`：参数化 JDK 与输出目录

| | before | after |
|---|---|---|
| JAVA_HOME | 固定读 `$env:JAVA_HOME` | 新增 `-JavaHome` 参数，缺省仍读环境变量 |
| 输出目录 | 固定 `runtime` | 新增 `-OutputDir`，缺省 `runtime` |
| 模块清单 | 不变 | 不变（32 位 JDK 同样提供这 16 个模块，已实测 jlink 成功） |

新增调用：`make-runtime.ps1 -JavaHome "<32位JDK>" -OutputDir runtime-x86`

> ⚠️ jlink **不能交叉产出**：`jmods` 是按平台定制的，64 位 JDK 造不出 32 位运行时。
> 必须用 32 位 JDK 跑 jlink。32 位 JDK 在 64 位 Windows 上可正常执行，所以本机就能构建。

### 5.2 `desktop/package.json`：新增字段与脚本

```jsonc
{
  "portableDirName": "EduPlay-便携版",              // 保持不变（64 位）
  "portableDirNameX86": "EduPlay-便携版(32位)",     // 新增
  "portableDataDirName": "EduPlay-用户数据（请勿删除）",  // 保持不变 → 两种架构共用数据

  "scripts": {
    "dist:portable:x86": "electron-builder --config electron-builder-x86.yml --win dir --ia32 && node scripts/rename-portable.js --arch ia32 --from release-portable-x86 --out release-portable-x86"
  }
}
```

**版本号刻意不动**：项目有 12 处版本真源 + lockfile 行号替换，为一个架构分支再动一遍不划算。
32 位与 64 位共用 `1.5.1`，靠**目录名**区分。

### 5.3 新增 `desktop/electron-builder-x86.yml`（完整配置，非差异）

必须把 `package.json` 的 `build` 段**整份抄过来**再改两点（原因见坑 3b）：

```yaml
appId: com.eduplay.desktop
productName: EduPlay
directories:
  output: release-portable-x86
files:
  - main.js
  - preload.js
extraResources:
  - from: ../backend/target/eduplay-backend.jar
    to: app.jar
  - from: runtime-x86          # ← 唯一实质差异：32 位运行时
    to: jre
    filter: ["**/*"]
win:
  icon: build/icon.ico
  target:
    - target: dir
      arch: [ia32]
electronLanguages: [zh-CN, en-US]
icon: build/icon.ico
```

### 5.4 `desktop/scripts/rename-portable.js`：支持 `--arch` 与 `--out`

| | before | after |
|---|---|---|
| 构建产物目录 | 写死 `win-unpacked` | `--arch ia32` → `win-ia32-unpacked`；缺省 `win-unpacked` |
| 交付根目录 | 写死 `release-portable` | `--out <目录>` 覆盖；缺省不变 |
| 目录名真源 | 读 `portableDirName` | `--arch ia32` 时改读 `portableDirNameX86` |
| `使用说明.txt` | 写 `release-portable/使用说明.txt` | 跟随 `--out`，文案里程序目录名用 x86 版 |
| 自检项 | 4 项 | 不变（`EduPlay.exe` / `portable.txt` / `resources/app.jar` / `resources/jre/bin/java.exe`） |

> 自检项里 `resources/jre/bin/java.exe` 属于**只看存在性**，看不出真假 32 位。
> 建议补一条**机器可验**的检查：读 `resources/jre/bin/java.exe` 的 PE 头机器码必须是 `0x14c`。

### 5.5 `desktop/main.js`：只加「32 位专属 JVM 参数」

`main.js` 里**没有任何架构假设**（`resolveJava()` / `resolveJar()` / `spawn` 全是路径拼接），
所以只需在 `startBackend()` 的 spawn 参数里按需注入内存参数：

```js
// 现状
["-jar", jar, `--server.port=${port}`]

// 32 位专属（只在 ia32 上生效）
const jvmArgs = process.arch === "ia32"
  ? ["-server", "-Xms64m", "-Xmx768m"]   // 32 位默认堆仅 256MB，显式抬高；-server 启用 C2
  : [];
spawn(java, [...jvmArgs, "-jar", jar, `--server.port=${port}`], { ... });
```

`process.arch` 在 Electron 里对 ia32 包会返回 `"ia32"`，无需额外配置文件来判断。

### 5.6 新增 `desktop/scripts/release-x86.ps1`

`release.ps1` 的 5 步里，32 位只需要改第 0 步（runtime）和第 4 步（打包），
中间两步（前端构建、后端 jar）与架构**无关**，可以复用产物、不必重跑：

```
[0/3] make-runtime.ps1 -JavaHome <32位JDK> -OutputDir runtime-x86
[1/3] 复用已有的 frontend/dist 与 backend/target/eduplay-backend.jar（架构无关）
[2/3] electron-builder --config electron-builder-x86.yml --win dir --ia32
[3/3] rename-portable.js --arch ia32 --from release-portable-x86 --out release-portable-x86
```

### 5.7 `desktop/.gitignore`

无需改动 —— 已有 `release-portable-*/` 与 `runtime/` 规则。
但 `runtime-x86/` **不在** `runtime/` 规则覆盖范围内，需要补一行 `runtime-x86/`。

---

## 6. 交付形态建议

```
U盘根目录/
├── EduPlay-便携版(32位)/          ← 程序（32 位，双击里面的 EduPlay.exe）
├── EduPlay-用户数据（请勿删除）/    ← 数据（两种架构共用同一个）
└── 使用说明.txt
```

**为什么数据目录两种架构共用：**
H2 是纯 Java 数据库，文件格式与 CPU 架构无关 —— 64 位版写的库，32 位版能直接读，反之亦然。
若两种架构各用一份数据目录，老师在"这台用 32 位、那台用 64 位"的场景下会看到**数据互相看不见**，
必须导出再导入，这是最容易出教学事故的地方。

⚠️ 但要注意：共用一个数据目录 ⇒ **不能同时运行两个版本的 EduPlay**（H2 文件锁），
这与"同一个版本开两个窗口"的现有约束一致，说明文档里要写清"先退出再换"。

---

## 7. 分阶段实施与验收

| 阶段 | 内容 | 验收标准（机器可验） |
|---|---|---|
| P1 运行时 | 用 32 位 JDK 造 `runtime-x86` | `runtime-x86/bin/java.exe -version` 输出含 `32-Bit`；PE 头 `0x14c` |
| P2 后端 | 32 位运行时 + 现有 jar 起临时实例 | health 返回 `UP`；Flyway 到 v14；注册+登录成功 |
| P3 打包 | electron-builder `--ia32` 出包 | 产出 `release-portable-x86/EduPlay-便携版(32位)/`；自检 4 项全 OK |
| P4 产物校验 | 检查 exe 与 jre 架构 | `EduPlay.exe` 与 `jre/bin/java.exe` 的 PE 头都是 `0x14c` |
| P5 真机 | 装出来的 exe **必须真跑一次** | 见下方三档 |

**P5 的三档真机验证**（缺一档就有一类问题盖不住）：

| 档 | 环境 | 能盖住什么 |
|---|---|---|
| ① | 本机 64 位 Windows（WoW64） | 打包完整性、路径/中文目录、启动链路 |
| ② | 32 位 Windows 虚拟机 | 32 位机型特有的 OOM、缺系统 DLL（`api-ms-win-*` 系列） |
| ③ | 目标学校真机 | 杀软拦截、U 盘速度、实际内存大小 |

> 只做 ① 是**不够**的：64 位 Windows 上的 WoW64 子系统比真 32 位系统宽容得多，
> 32 位系统真正缺的 DLL 在 ① 里根本不会暴露。

---

## 8. 风险与截止日期

| 风险 | 影响 | 应对 |
|---|---|---|
| **Electron 43 于 2027-01 EOL** | 之后 32 位版**没有安全补丁** | 把 32 位版定位为过渡/兜底；同时推动换 64 位机器 |
| **BellSoft 可能跟进停发 i586** | 32 位运行时断供 | 每年复查一次；**把 JDK 包归档进仓库/网盘**（自持一份，别只依赖在线下载） |
| **Windows 10 32 位已于 2025-10 EOL** | 目标系统本身无安全更新 | 交付前与学校确认机型清单，避免为极少数机器长期维护 |
| 32 位地址空间 2 GB | 大数据量时报 OOM | 显式 `-Xmx768m`；P5 ② 档压测 |
| 两种架构共用数据目录 | 不能同时运行 | 文档写明"先退出再换" |

---

## 9. 需要你拍板的两件事

1. **32 位版是"长期并行维护"还是"一次性兜底"？**
   若是前者，值得把 `release-x86.ps1` 做进 `npm run release` 全流程；
   若是后者，可以连 `electron-builder-x86.yml` 都省略，构建时临时换 `runtime` 目录（更省事但更容易忘）。

2. **32 位版是否需要"安装版"（NSIS）？**
   NSIS 的 `--ia32` 同样可用，但老机房通常直接给 U 盘便携版更省事；
   不做安装版可以省掉一份 `nsis` 配置与一次真机验证。

---

## 10. 实施记录（2026-10-11 完成）

**结论：已按本设计落地，并真机跑通。** 施工时对命名做了一处统一，见下。

### 10.1 与设计稿的差异

| 项 | 设计稿 | 实际落地 | 原因 |
|---|---|---|---|
| 目录 / 文件命名 | `-x86`（`runtime-x86` / `electron-builder-x86.yml` / `release-portable-x86`） | **`-32`**（`runtime-32` / `electron-builder-32.yml` / `release-portable-32`） | 与约定的交付目录名 `release-portable-32` 对齐；一套后缀贯穿到底，不混用 x86 / 32 两种说法 |
| 程序目录名 | `EduPlay-便携版(32位)`，新增 `portableDirNameX86` 字段 | `EduPlay-便携版-32`，**不新增字段** | 少一处「名称真源」；且半角括号在命令行 / 批处理里容易被特殊处理 |
| `make-runtime.ps1` 参数 | `-JavaHome` + `-OutputDir` | `-JavaHome` + `-Output` | 措辞统一 |
| 独立发布脚本 | 建议新增 `release-x86.ps1` | **未新增** | 本次是单次交付；等「长期并行维护」拍板后再做进 `npm run release`（见 §9） |

### 10.2 实际改动清单

**新增**
| 文件 / 目录 | 说明 |
|---|---|
| `desktop/runtime-32/` | 32 位裁剪运行时，79 MB |
| `desktop/electron-builder-32.yml` | 32 位全量打包配置（因 `--config` 不合并 package.json 的 build 段） |
| `desktop/package.json` 的 `dist:portable:32` | `electron-builder --win dir --ia32 --config electron-builder-32.yml && node scripts/rename-portable.js --arch ia32` |

**修改（5 个，全部在打包侧）**
| 文件 | 改了什么 |
|---|---|
| `desktop/main.js` | 新增 `resolveJvmArgs()`；spawn 参数由 `["-jar", …]` 变为 `[…resolveJvmArgs(), "-jar", …]`。仅 `process.arch === "ia32"` 时返回 `["-Xms64m","-Xmx768m","-server"]` |
| `desktop/scripts/make-runtime.ps1` | 新增 `-JavaHome`（缺省 `$env:JAVA_HOME`）与 `-Output`（缺省 `runtime`）；**不传参时行为与改造前等价** |
| `desktop/scripts/rename-portable.js` | 新增 `--arch <x64\|ia32>`（缺省 x64，行为不变）；按架构取 `win-ia32-unpacked`；交付根与程序目录名加 `-32` 后缀；新增 `readPeMachine()` 与**架构自检** |
| `desktop/package.json` | 仅新增一条 script |
| `desktop/.gitignore` | 新增 `runtime-32/`、`runtime-32.tmp/` |

**未改动**：`backend/**`、`frontend/**`、`admin-frontend/**`、`admin-backend/**`，以及 64 位链路的任何一处。

### 10.3 验收结果（全绿）

| 阶段 | 验收项 | 结果 |
|---|---|---|
| P1 | `runtime-32/bin/java.exe -version` | ✅ `OpenJDK 32-Bit Client VM`；PE 头 `0x14c` |
| P1 | 裁剪运行时里 Server VM 是否还在 | ✅ `bin/server/jvm.dll` 存在，`jvm.cfg` 含 `-server KNOWN` |
| P2 | 32 位运行时 + 现有 jar 起隔离实例 | ✅ 13 秒就绪、health `UP`、Flyway v14、注册 / 登录成功、H2 落盘 |
| P2 | `-server` 是否真切到 C2 | ✅ 默认 → `Client VM`；加 `-server` → **`Server VM`**（同一个 exe 对照实测） |
| P3 | electron-builder `--ia32` 出包 | ✅ 1 分 29 秒；`release-portable-32/win-ia32-unpacked` → 重命名为 `EduPlay-便携版-32` |
| P4 | 产物架构 | ✅ `EduPlay.exe` / `jre/bin/java.exe` / `jre/bin/server/jvm.dll` 三者 PE 头均 `0x14c (i386)` |
| P4 | 打包后自检 | ✅ 4 项常规 + 2 项架构自检全 OK |
| P5① | **真机启动一次**（64 位 Windows / WoW64） | ✅ 数据目录在程序目录**旁边**自动创建、后端 `UP`、`index.html` 200、入口 JS `index-D2n6_mvj.js` 200（与 64 位同一哈希 ⇒ 两份产物共用同一套前端） |

> ⚠️ **P5 的 ②③ 两档仍未做**（32 位 Windows 虚拟机 / 目标学校真机）。
> 64 位 Windows 的 WoW64 比真 32 位系统宽容得多，缺 `api-ms-win-*` DLL 这类问题在这一档盖不住。
> 现产物可判定为「在 64 位机器上完备」，但**发到真 32 位机器前，建议先过一遍 ②**。

### 10.4 交付物

```
desktop/release-portable-32/
├── EduPlay-便携版-32/         369 MB   ← 程序（32 位），双击里面的 EduPlay.exe
├── EduPlay-便携版-32.zip      ~200 MB  ← 分发用压缩包
├── 使用说明.txt                         ← 文案已自动带上「EduPlay-便携版-32」
└── builder-debug.yml                    ← electron-builder 常规输出（64 位交付里也有）
```

数据目录**不在**交付物里：首次运行后才在程序目录**旁边**生成 `EduPlay-用户数据（请勿删除）/`。

### 10.5 复现命令

```powershell
# ① 32 位运行时（已有则跳过；jlink 不能交叉产出，必须用 32 位 JDK）
powershell -File desktop/scripts/make-runtime.ps1 `
  -JavaHome "C:\Users\Administrator\AppData\Local\Temp\wb32\jdk-21.0.12" -Output runtime-32

# ② 出包 + 整理（一条命令走完）
cd desktop
$env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run dist:portable:32
```

> ⚠️ `ELECTRON_MIRROR` 必须指向 `cdn.npmmirror.com/binaries/electron/`：
> `electron-v36.9.5-win32-ia32.zip` 在那里（HTTP 200），官方 GitHub 直链在本网络被拦（CONNECT 502）。
> 首次构建会下载约 100 MB，之后走缓存。

---

## 附：复现命令

```bash
# ① 取 32 位 JDK 21（GitHub 直链在本网络被拦，走 BellSoft CDN）
curl -L -o jdk21-x86.zip \
  "https://download.bell-sw.com/java/21.0.12+10/bellsoft-jdk21.0.12+10-windows-i586.zip"
unzip -q jdk21-x86.zip                     # → jdk-21.0.12/

# ② 验证是真 32 位
./jdk-21.0.12/bin/java.exe -version        # → OpenJDK 32-Bit Client VM
./jdk-21.0.12/bin/java.exe -XX:+PrintFlagsFinal -version \
  | grep MaxHeapSize                       # → 268435456（256 MB）

# ③ 造 32 位裁剪运行时（模块清单与 make-runtime.ps1 完全一致）
MODULES="java.base,java.desktop,java.compiler,java.instrument,java.logging,java.management,\
java.naming,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,\
java.xml,jdk.crypto.ec,jdk.localedata,jdk.unsupported"
./jdk-21.0.12/bin/jlink.exe --add-modules "$MODULES" --strip-debug \
  --no-header-files --no-man-pages --include-locales=en,zh-CN --output runtime-x86

# ④ 用 32 位运行时跑后端（隔离端口，别碰 7070）
mkdir -p appdata && cd appdata
../runtime-x86/bin/java.exe -jar <仓库>/backend/target/eduplay-backend.jar --server.port=17099
# 另一个终端：
curl http://127.0.0.1:17099/api/v1/health
curl -X POST http://127.0.0.1:17099/api/v1/auth/local/register \
  -H "Content-Type: application/json" \
  -d '{"username":"x86test","password":"Test1234","nickname":"32bit-verify"}'

# ⑤ 检查任意 PE 文件的架构（0x14c=i386 32位 / 0x8664=x64 64位）
python -c "
import struct,sys
d=open(sys.argv[1],'rb').read(0x200)
off=struct.unpack_from('<I',d,0x3c)[0]
print({0x14c:'i386(32位)',0x8664:'x64(64位)'}.get(struct.unpack_from('<H',d,off+4)[0]))
" runtime-x86/bin/java.exe
```
