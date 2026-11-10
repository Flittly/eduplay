# 32 位平台对教学游戏的兼容性验证

验证日期：2026-10-11　验证人：AI 辅助（奇偶瓜肥实验室）
结论：**13 个教学游戏不需要 32 位版本，一份游戏包同时适用于 64 位与 32 位平台。**

## 一、验证对象

`E:/Self/workspace/eduplay-games` 下全部 13 个游戏的交付包 `dist/web`。

| 项 | 结果 |
|---|---|
| manifest `type` | 全部 `iframe` |
| manifest `backendPlugin` | 全部 `null` |
| entry | 全部 `web/index.html` |
| 运行时依赖 | 仅 `react` / `react-dom`（部分加 `three`） |
| 交付包文件类型 | 只有 `css / html / jpg / js / json / png / svg` |
| 原生二进制（`.exe/.dll/.node/.so`） | **0 个** |
| WebAssembly（`.wasm`） | **0 个** |

## 二、验证环境

- 宿主：64 位 Windows（32 位 Electron 以 WoW64 方式运行）
- Electron：`36.9.5 win32-ia32`（与 32 位便携版同版本）
- **非**：真 32 位 Windows 系统（这一档尚未验证，见 §五）

## 三、实测结果

### 3.1 图形能力（WebGL2）

| 检查项 | 结果 |
|---|---|
| WebGL / WebGL2 | 均可用（`gpuFeatureStatus`: `enabled`） |
| 实际渲染后端 | `ANGLE (Intel, Intel(R) UHD Graphics 770, Direct3D11 vs_5_0 ps_5_0, D3D11)` — **硬件加速** |
| 是否软件渲染 | `false` |
| `MAX_TEXTURE_SIZE` / `MAX_RENDERBUFFER_SIZE` | 16384 / 16384 |
| `MAX_SAMPLES`（MSAA） | 8 |
| 压缩纹理 | S3TC ✓ |
| 实例化 / VAO / 浮点颜色缓冲 | 全部 ✓ |

### 3.2 渲染目标能力（尺寸梯度）

| 形态 | 256 | 1024 | 2048 | 4096 |
|---|---|---|---|---|
| 纯颜色 | COMPLETE | COMPLETE | COMPLETE | — |
| 颜色 + 深度纹理 | — | COMPLETE | COMPLETE | COMPLETE |
| MSAA 4x | — | COMPLETE | — | — |

全部 `FRAMEBUFFER_COMPLETE`，`glError = 0`。

### 3.3 真实游戏加载

| 游戏 | 技术栈 | 结果 |
|---|---|---|
| `mountain-zones` | React + three.js | 2 个 canvas 正常（600×412 / 600×252），三维地形渲染完整 |
| `solar-system` | React + three.js | 1 个 canvas 正常（1264×735），行星轨道动画在跑 |
| `china-relief` | React（DOM 渲染） | 页面结构完整，无 canvas 属正常 |

三者控制台**无错误日志**（仅 Electron 自带的 CSP 提示）。

截图见本目录 `32bit-game-mountain-zones.png`、`32bit-game-solar-system.png`。

## 四、为什么不需要 32 位版本

游戏包是**网页**（HTML/JS/CSS/图片），不是**程序**。它运行在平台内嵌的 iframe 里，
由后端 `/api/v1/plugin/{token}/{gameCode}/{version}/{entry}` 以静态资源方式供给。
网页内容本身与 CPU 架构无关 —— 更换架构的是「浏览器/Eletron 外壳」，不是网页内容。

对比之下，**必须**按架构分别构建的只有两样：

1. Electron 运行时（`EduPlay.exe` 及其 `*.dll`）
2. 内嵌的 JRE（`jre/bin/java.exe`、`jvm.dll`）

这两样正是 32 位便携版已经单独打包的部分。

## 五、尚未验证的边界

**真 32 位 Windows 机器**。本机为 64 位系统，32 位 Electron 走 WoW64 兼容层，
比真 32 位系统宽容（例如不会暴露「缺 `api-ms-win-*` 系列 DLL」这类问题）。
发到真 32 位机器前建议先过一遍虚拟机 —— 与主方案 `docs/portable-x86-design.md` 的 P5② 是同一件事。

另一个真实约束是**地址空间**：32 位进程上限约 2 GB。游戏运行在独立渲染进程中并已实测通过；
但在内存本就不大的老机器上，整体余量会比 64 位紧。

## 六、复现命令

```bash
# 1. 取 32 位 Electron（与 32 位便携版同版本）
#    缓存位置：%LOCALAPPDATA%\electron\Cache\<hash>\electron-v36.9.5-win32-ia32.zip

# 2. 起一个 MIME 正确的静态服务器供货（关键：.js 必须是 text/javascript）
#    注意：Python 自带 http.server 返回 application/javascript，
#    Chromium 的动态 import 会拒绝，必须覆写 extensions_map。

# 3. 用 32 位 electron.exe 加载游戏入口并截图
electron.exe <probe-app> -- "http://127.0.0.1:<port>/" shot.png 9000

# 4. 采集页面信息（canvas 数量/尺寸、WebGL renderer、控制台日志）
#    见 <probe-app>/main.js 的 executeJavaScript 段
```
