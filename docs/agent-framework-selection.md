# EduPlay 接入 Agent 框架选型评估

> 评估日期：2026-10-09　评估对象：LangChain / AgentScope Java 2.0 / Pi Agent / 自研
> 本文所有框架事实均标注来源，并区分「官方原文」与「第三方转述」；未能核准的一律列在 §7。
> 结论只针对 **EduPlay 当前形态**（Spring Boot 4.1.1 + JDK 21 + H2 本地库 + React 老师端 + Electron 壳），
> 换项目不成立。

---

## 0. 一句话结论

**你给的四个候选里，没有一个能直接落在这个项目上；但其中两个（LangChain、Pi Agent）不是「差」，是「放错了地方」。**

- **LangChain** 和 **Pi Agent** 都是 Python / Node 生态。这个项目的主线是「本地 jar 就是网页版，Electron 只负责启动它」，
  把 agent 放在 Node 或 Python 里，等于**只在 Electron 里能用、浏览器直开 7070 就没了**，或者往 400MB 便携包里再塞一个运行时。
- **AgentScope Java 2.0** 是四个里唯一 Java 原生、又真正以「Agent」为核心抽象的，代价是它 2026-07 才 GA，API 还在动。
- **自研**的临界点很明确：**「多轮自主循环 / 长期记忆 / 人工确认」这三样里占了两样，自研就开始不划算**。

⚠️ **另外你漏了两个对这个项目更贴的候选**：**Spring AI 2.x**（你后端就是 Spring Boot 4.1.1，它在 Boot 4 上是零摩擦）
和 **LangChain4j**（Java 版的 LangChain）。真正的 LangChain **没有 Java 实现**。

---

## 1. 先决问题：Agent 跑在哪个进程里

这一步比「选哪个框架」更决定答案。同一个框架放在不同位置，成本和可用性差一个量级。

| 落点 | 覆盖「浏览器直开 127.0.0.1:7070」的网页版 | 新增运行时 | 能否同进程读本地教学数据 | 便携包体积 | 可选框架 |
|---|---|---|---|---|---|
| **A. 本地后端**（`backend` jar） | ✅ | ❌ 不需要 | ✅ 同进程 JPA，13 张本地表直接当工具 | 不变 | AgentScope Java / Spring AI / LangChain4j / 自研 |
| **B. 云端后端**（`admin-backend` 17070） | ✅ | ❌ 不需要 | ❌ 教学数据不在云端，只有账号 + 商城 | 不变 | 同上 |
| **C. Electron 主进程**（Node） | ❌ **网页版完全没有这个能力** | ❌ Node 已有 | ❌ 要跨进程通信 | +少量 | Pi Agent / LangChain JS |
| **D. Python 侧车进程** | ✅ | ✅ **嵌入式 Python** | ❌ 要跨进程 + 独立鉴权 | **+50~80MB** | LangChain / AgentScope Python |

**为什么优先 A（三条，按重要性排）**：

1. **只有 A 能同时覆盖三种交付形态**（浏览器网页版 / exe 安装版 / U 盘便携版）。C 会让「网页版」这个卖点出现功能断层。
2. **只有 A 不用新增运行时**。这个项目为此已经付出了一整套代价（jlink JRE 79MB、启动时序、健康检查、端口稳定），
   再加一个运行时，等于把 §6 那些坑复制一遍。
3. **只有 A 能同进程访问教学数据**。`student` / `teacher_class` / `student_points_ledger` 这些本地独有表，
   在 A 里就是几个 `@Tool` 方法；在 C/D 里要先设计一层内部 API + 鉴权。

> B 的位置比较特殊：它够不到教学数据，所以适合「跨校/跨师的内容生成类 agent」（比如生成题目、生成教案），
> 不适合「操作我自己班名单」这类 agent。**如果你想两者都要，就会变成 A+B 两个 agent，那更要先想清楚边界。**

---

## 2. 四个候选的真实画像

### 2.1 LangChain（Python / JS）

**现状**：1.0 于 2025-10 发布，把 LangGraph 变成正式依赖；`langchain-core` 到 2026-07 是 1.5.3。
核心资产已经从「链」转移到 **LangGraph**：图式编排（节点/边/共享状态）、checkpoint 断点续跑、
`interrupt` 人工介入、流式输出；配套 LangSmith 做 trace 与成本观测。

**对本项目的硬伤**：🔴 **没有 Java 实现**。要落在 A/B，只能起 Python 侧车（即落点 D）。

**要注意的历史包袱**：1.0 之前「抽象层太厚、小版本破坏性变更」的批评是真实发生过的
（Octomind 团队曾公开弃用并改回直调 API）。1.0 引入正式废弃策略正是对这件事的回应。

> 来源：LangChain 官方论坛 v1.0 公告（经第三方转述，未取到公告原文）；atlan.com《What is LangChain (2026)》；
> CSDN《LangChain 2026 深度解析》。**1.0 的确切发布日期我没拿到官方原文，标注为待核。**

### 2.2 AgentScope Java 2.0 —— 四个里唯一 Java 原生的 Agent 框架

**官方原文（我直接读了 GitHub README）**：Apache-2.0，**JDK 17+**，
Maven 坐标 `io.agentscope:agentscope-harness:2.0.3`（只想要推理内核则只依赖 `agentscope-core`）。
**v2.0.0 GA 于 2026-07**，官方称内部 13+ 业务单元在用。

**双层架构**：`ReActAgent`（推理内核，解决「一个回合」）+ `HarnessAgent`（工程化外壳，按需叠加，不替换内核）。

**与其它框架差异最大、且正好对你有用的四点**：

| 能力 | 为什么对你重要 |
|---|---|
| **31 种类型化事件流**（`call()` / `streamEvents()`） | 事件本身就是给前端渲染设计的（文本增量、工具调用开始、工具结果…），你 React 端接流不用自己定义协议 |
| **三态权限 allow / approve / deny** | 「AI 想改名单 → 先弹给教师确认」是框架一等公民，不用自己造闸门 |
| **Workspace 抽象**（`AGENTS.md` / `MEMORY.md` / skills / subagents 都是文件；沙箱一行切 local / Docker / K8s / E2B） | 记忆和技能落盘，换机/便携场景可跟随数据目录 |
| **Middleware 六钩子**（onAgent/onReasoning/onActing/onModelCall/onSystemPrompt/onAgentStateReady） | 日志、审计、注入教学上下文都能挂，不用改内核 |

**模型**：文档默认以 `dashscope:qwen-plus` 举例，但 provider 是**独立扩展模块**
（`agentscope-extensions-model-` 后接 openai / anthropic / gemini / **ollama**）。Ollama 在列 ⇒ 本地模型可行。

**🟡 代价（要如实看）**：

- 2.0 GA 到 2026-07，距今约 3 个月；且 **1.0 → 2.0 是不兼容重写**（消息模型、事件、middleware 全改）
  ⇒ 说明它自己还在快速演进，你要接受「跟着升级」这件事。
- 基于 **Project Reactor**（`Mono` / `Flux`），而你后端现在是 `spring-boot-starter-webmvc`
  ⇒ **要新引入 Reactor 依赖**（不算大，但是新依赖）。
- 文档示例默认绑阿里云 DashScope，非阿里云 provider 要自己挑扩展模块、自己验证。

### 2.3 Pi Agent（`pi` / Pi Agent Harness）

**官方 README 原文**：MIT，`earendil-works/pi` 单仓多包，**要求 Node.js ≥ 22.19**。

| 包 | 职责 |
|---|---|
| `@earendil-works/pi-ai` | 统一多 provider LLM API（OpenAI / Anthropic / Google…） |
| `@earendil-works/pi-agent-core` | Agent 运行时：工具调用 + 状态管理 ← **要嵌自己的应用就用这个** |
| `@earendil-works/pi-tui` | 终端 UI（差分渲染） |
| `@earendil-works/pi-coding-agent` | 交互式编码 agent CLI |
| 另含 | `chord`（应用组合运行时）、`pi-telemetry`、`pi-durable` |

**它的定位非常明确，而且它自己写得很直白**：面向软件工程的**极简编码 agent 骨架**，默认只给
read / write / edit / bash 四个工具，**刻意不带 sub-agent 和 plan mode**，并**明确声明不含内置权限系统**
（「按启动它的用户和进程的权限运行」，要边界请自己上 Docker/沙箱）。

**v1.0 发布于 2026-10-01**（距今 8 天），官方定位是「给基于 SDK 建东西的人一个 API 稳定信号」。

**🟡 对你意味着什么**：

- 它的生态是**编码 agent 生态**（让模型改你的文件），不是**业务 agent 生态**（让模型调你的业务接口）。
  用 `pi-agent-core` 当然能跑，但记忆、权限、业务工具注册、前端事件——**你都要自己长**，工作量与自研同量级。
- 它只在 Node 里跑 ⇒ 只对应落点 **C**，网页版享受不到。
- star 数很唬人，但**第三方口径从 6.9 万到 11.1 万都有，我无法核准**（见 §7）。

**一句话**：**它是四个里最不适合这个项目的**——除非你真实的目标其实是「给自己做一个能改 EduPlay 仓库的编码助手」，
那它反而是最优解。

### 2.4 自研

**规模量级**：ReAct 循环 + 工具注册 + 流式输出，最小实现大约 **300~600 行 Java**
（把重试、超时、工具参数 schema 自动生成算进去会更长）。

**自研真正省下的**：零新依赖、零新运行时、零学习成本、行为 100% 可指、不担心上游破坏性变更。

**自研真正要自己养的（按成本递增）**：
工具 schema 与参数校验 → 流式事件协议 → 多轮上下文裁剪/压缩 → 重试与降级 → 人工确认闸门 → trace 与成本统计 → 多 agent。

> **临界点**：「多轮自主循环」「长期记忆」「人工确认」三样里占两样，维护成本就超过「引入 + 学框架」。

---

## 3. 你漏掉的两个候选（对本项目可能更贴）

### 3.1 Spring AI 2.x

**官方文档确认的能力**：多 provider 可移植 API（含 **Ollama**）、结构化输出（映射到 POJO）、
`@Tool` 工具调用、**Advisors API**（可组合地包住 LLM 调用：记忆、RAG 上下文注入、日志、限额都能做成 Advisor）、
**MCP**（既能消费 MCP server，也能把 Spring 服务暴露给 AI 生态）、Spring Boot 自动配置与 Starter、可观测。

**为什么它对你特别贴**：你后端就是 **Spring Boot 4.1.1**。第三方横评里有一句判断可以直接套用：
「如果你已经在 Boot 4 上了，Spring AI 2.x 就是默认选项」——你正好满足这个前提条件。

**🟡 代价**：它的 **agent 编排能力明显弱于** AgentScope / LangGraph（核心是「一次带工具的调用 + Advisor 链」）；
多智能体、长任务、断点续跑要自己搭。另有第三方文章称 Spring AI 修过 7 个 CVE（其中一个涉及「提示词可让模型调到
未声明工具」）——⚠️ **此条我未在官方渠道核准，请自行核实**。

### 3.2 LangChain4j

**定位**：Java 社区实现，心智最接近 Python LangChain。1.x 把 agent 能力拆进 `langchain4j-agentic`，
另有 `langchain4j-guardrails`（**输入护栏**能在模型看到之前拦 prompt injection / 脱敏 PII，
**输出护栏**能在返回给业务之前校验），20+ provider。有 Microsoft 官方的合作伙伴公告
（「安全的企业级 Java AI 应用」方向）。不依赖 Spring 容器，跨框架使用无压力。

**🟡 代价**：非 Spring 官方出品；provider 的新特性通常比原生 SDK 晚几周；升级节奏快 ⇒ 偶有破坏性变更。

---

## 4. 横向对比总表

| 维度 | AgentScope Java 2.0 | Spring AI 2.x | LangChain4j | LangChain(Py/JS) | Pi Agent | 自研 |
|---|---|---|---|---|---|---|
| 语言 / 运行时 | **Java（无需新增运行时）** | **Java（同）** | **Java（同）** | Python / Node | Node ≥22.19 | Java |
| 许可证 | Apache-2.0 | Apache-2.0（Spring 系） | Apache-2.0 | MIT | MIT | — |
| 成熟度 | GA 2026-07（约 3 个月） | 2.0 GA 2026-06；Spring 官方节奏 | 1.x GA，迭代快 | 1.0 GA 2025-10，生态最大 | v1.0 2026-10-01（8 天） | 取决于你 |
| 与 Boot 4.1.1 集成 | 框架无关（要自接 Reactor） | **Boot 原生（autoconfig/starter/actuator）** | Spring 友好，非官方 | 无 | 无 | 无 |
| 覆盖网页版（落点 A/B） | ✅ | ✅ | ✅ | 仅 D | ❌ 仅 C | ✅ |
| 便携包体积影响 | 基本不变 | 基本不变 | 基本不变 | +50~80MB(侧车) | 几乎不变(仅 Electron) | 不变 |
| Agent 原生度（循环/多agent/记忆/HITL） | **最强**（Harness+Subagent+Workspace 记忆+三态权限） | 中（ReAct + Advisor，多 agent 自己搭） | 强（agentic 模块 + 护栏） | **最强**（LangGraph 图编排 + checkpoint + interrupt） | 中高（core 精简，其余靠扩展） | 从零 |
| 事件流直供前端 | ✅ 31 种类型化事件 | ✅ streaming（需自己组事件） | ✅ streaming | ✅ `stream_mode="updates"` | ✅ 事件订阅 | 自己定义 |
| MCP | ✅ | ✅（**双向**：消费 + 暴露） | ✅ | ✅（mcp-adapters） | 1.0 起支持（Codemode/QuickJS） | 自己接 |
| 本地模型（Ollama） | ✅ 扩展模块 | ✅ | ✅ | ✅ | ✅（15+ provider） | 看你 |
| 主要学习成本 | 中高（Reactor + Harness 概念） | **低**（对 Spring 人） | 中 | 高（抽象多） | 中（但要自己补齐） | 低起步，长期高 |
| 最大风险 | 2.0 新、API 仍可能动 | agent 能力偏薄 | 破坏性变更 | 落点不匹配（Java 项目） | **落点不匹配 + 领域不匹配** | 需求一长就失控 |

---

## 5. 如果让我排（针对 EduPlay 当前形态）

### 场景 1：AI 只是「锦上添花」
> 例如教师端一句话生成随堂评语、按名单智能分组、给游戏页生成提示语。

→ **Spring AI 2.x + 落点 A**，或者**干脆自研**一个带工具的 `ChatClient` 调用。
理由：需求是「一次调用 + 一两个工具」，上 Agent 框架是杀鸡用牛刀。

### 场景 2：要做真正的「AI 助教」
> 多轮对话、能查名单/积分/游戏进度、写操作前要教师确认、结果要流式推到 React 前端。

→ **AgentScope Java 2.0 + 落点 A** 是我认为最贴的（事件流 + 三态权限 + Workspace 记忆三样正好对上）。
→ 若你更看重「不引入新范式、跟着 Spring 官方走、团队认知成本低」，**退一档选 LangChain4j + 落点 A**。

### 场景 3：你想先低成本验证「这事做不做得动」
→ **自研一个 500 行的 ReAct**，跑通「自然语言 → 调一个真实业务接口 → 写进 H2」这条链。
这一步打通后，你是**带着需求去挑框架**，而不是**带着框架找需求**。

### 明确不建议的两条

- ❌ **别引入 Python 侧车**。除非你愿意接受便携包从 400MB 变 470MB+，并且多管一个进程的生命周期与鉴权。
- ❌ **别为 Pi Agent 改架构**。它解决的是「让 AI 改代码」，不是「让 AI 用你的业务」。
  想用它的正确姿势是另一个独立项目：给开发者/自己做一个能读这个仓库的编码助手。

---

## 6. 你可以用来自己判断的清单

### 三个必答问题（答不上来就别选型）

1. **Agent 具体要干哪三件事？**（要具体到「能查到 X、能改 Y」，不能是「智能一点」）
2. **哪些操作必须教师点头？**（决定你要不要三态权限 / 人工确认闸门）
3. **失败时用户看到什么？**（决定你要花多少力气在重试、降级、可观测上）

### 带权重的打分表（自己填 1~5 分）

| 维度 | 权重（你定） | AgentScope Java | Spring AI | LangChain4j | 自研 |
|---|---|---|---|---|---|
| 覆盖三种交付形态 | | | | | |
| 不新增运行时 / 不涨包体积 | | | | | |
| 能不能同进程读教学数据 | | | | | |
| 团队（你自己）学习成本 | | | | | |
| 事件流对接现有 React 前端 | | | | | |
| 人工确认 / 权限闸门 | | | | | |
| 记忆与上下文管理 | | | | | |
| 上游稳定性（会不会明年重写） | | | | | |
| 出问题时能不能自己查（可观测） | | | | | |
| **加权合计** | 100% | | | | |

---

## 7. 我没核准的点（请自行核实后再决策）

1. **Pi 的 star 数**：第三方来源给出 6.9 万 / 7.8 万 / 10.6 万 / 11.1 万多种口径，**互相矛盾，我无法核准**。
2. **Spring AI「7 个 CVE」**：来自一篇第三方博客，含「提示词调用未声明工具」这种严重描述。**未在官方渠道核准**。
   这条如果为真，会实质影响「把 agent 放进本地 jar 并持有 API key」的风险评估。
3. **LangChain 1.0 的确切发布日期**：多篇第三方一致指向 2025-10，但未取到官方公告原文。
4. **Spring AI 2.x 要求的 Boot 版本与你 4.1.1 的兼容边界**：第三方说 2.x 需要 Boot 4，
   但**请以你实际引入时的 BOM 与官方兼容矩阵为准**。
5. **AgentScope Java 2.0.3 是否为你引入时的最新版**，以及 `agentscope-core` 与 `agentscope-harness` 的取舍。
6. 三者许可证虽是 Apache-2.0 / MIT / Apache-2.0，**若考虑商用或上架，建议自己过一遍条款**。

---

## 8. 建议的验证步骤（三轮，别一次到位）

| 轮次 | 目标 | 做法 | 通过标准 |
|---|---|---|---|
| **第 1 轮** | 打通链路可行性 | 在 `backend` 起一个**临时实例**（别碰 7070），注册 1 个读工具（如「按班级名查人数」）+ 1 个写工具（如「加积分」），跑通「自然语言 → 工具调用 → 写 H2」 | 能跑通，且**能看清每一步**（有日志/事件） |
| **第 2 轮** | 横向比 2 个候选 | 同一个任务分别用 **AgentScope Java** 与 **Spring AI**（或 LangChain4j）实现，都接同一个前端流式协议 | 比较：代码行数、调试难度、前端接入成本、包体积变化 |
| **第 3 轮** | 压力与失败面 | 故意让模型选错工具、故意让工具抛异常、故意打断流 | 框架给的兜底够不够；不够的地方就是你未来的维护成本 |

> ⚠️ 每轮都记两个数字：**新增依赖数** 和 **便携包体积变化**。这个项目的体积已经很敏感（1.5.0 实测 400.8MB），
> 框架引入后要用同一套打包流程复测一次。

---

## 附：来源清单

**官方一手**
- AgentScope Java 官网 / 文档：https://java.agentscope.io/ 、https://java.agentscope.io/v2/zh/blogs/agentscope-v2-explained
- AgentScope Java 仓库 README（直接抓取原文）：https://github.com/agentscope-ai/agentscope-java
- Pi 仓库 README（直接抓取原文）：https://github.com/earendil-works/pi
- Spring AI 官方参考文档：https://docs.spring.io/spring-ai/reference/
- LangChain 生态入口：https://www.langchain.com/

**第三方（仅作参考，判断需交叉验证）**
- 《Spring AI vs LangChain4j in 2026》dev.to/jamilxt
- 《Java AI agent frameworks in 2026: a practical comparison》codewiz.info
- 《Spring AI vs LangChain4j vs AgentScope 2.0：2026 年 Java AI 框架横评》
- 《LangChain 2026 深度解析：v1.x 架构演进、LangGraph 与 MCP 的工程实践》
- Pi Agent 相关：pyshine.com / ailinklab.com / mlllm.io / superteams.ai / libraries.io
