---
title: EduPlay 老师端前端代码审查（bug 与逻辑缺陷）
date: 2026-11-25
scope: frontend/src（27 个 TS/TSX，6,930 行）+ 与 backend 的接口契约
reviewer: UI 设计全栈专家团 · 主理人（代码级审查）
severity_legend: 高 = 数据丢失 / 凭证泄露 / 功能不可用；中 = 结果错误或状态错乱；低 = 体感与可维护性
---

**一句话结论**：前端骨架（路由守卫、名单变更广播、全屏/portal、红包发牌）设计是扎实的，
但有 3 个高优先问题会真实造成损害——**会话 token 进入 iframe URL**、**启动期网络抖动被误判为登录失效并清空本地登录态**、
**积分输入框无法清空导致一次误触把学生积分写回 0**；另有 10 处中低问题集中在「竞态、错误态生命周期、版本比较」上。

---

## 1. 审查范围与依据

### 1.1 逐行通读（27 个文件 / 6,930 行）

| 层 | 文件 | 行数 |
|---|---|---|
| 入口/路由 | `App.tsx`、`main.tsx`、`theme.ts` | 167 / 19 / 30 |
| 数据层 | `api.ts`、`rosterStore.ts`、`rememberCredentials.ts`、`types.ts`、`i18n.tsx` | 566 / 63 / 74 / 151 / 264 |
| 布局与常驻组件 | `layout/AppLayout.tsx`、`components/FloatingPick.tsx`、`InfoDialog.tsx`、`ProfileDialog.tsx` | 158 / 568 / 111 / 150 |
| 业务逻辑 | `hooks/useRandomPick.ts` | 213 |
| 页面 | `GamePage`、`StorePage`、`RedPacketPage`、`StudentRosterPage`、`StudentPointsPage`、`SeatingPage`、`SettingsPage`、`DashboardPage`、`LoginPage`、`RollCallPage`、`ClassesPage`、`RandomPickPage`、`ToolboxPage` | 833 / 523 / 486 / 365 / 395 / 377 / 354 / 261 / 219 / 192 / 151 / 154 / 63 |

### 1.2 反向核对的后端契约（只做契约确认，不审后端代码）

| 结论 | 证据 |
|---|---|
| 白名单含 `/api/v1/students/import/template`，`<a href>` 不带 token 是**合法**的 | `backend/.../auth/AuthFilter.java:76` |
| `/store/games/{code}/manifest` 返回**裸 JSON**，不是 `ApiResponse` 包装 | `GameStoreController.java:102-109` ↔ `api.ts:362-387` 两处一致 |
| 成绩提交按 `gameCode:studentId:roundId` 幂等，重复提交不会重复加分 | `GameScoreService.java:71,103` |
| 未授权返回 **401** + `{code:"UNAUTHORIZED"}` JSON | `AuthFilter.java:124` |
| 云端代理**透传**上游状态码，401 不会被吞成 200 | `CloudApiProxyController.java:78` |
| 会话 token **永不过期**（`9999-01-01`），泄露即长期有效 | `AuthService.java:36-37,210` |
| `/api/v1/plugin/{token}/...` 的 `token` 就是**主登录 token 本身** | `PluginContentService.java:49` `authService.requireUserByToken(token)` |

### 1.3 方法与未覆盖范围

- 只做**只读审查**，未修改任何源码（本文件是唯一新增产物）。
- 逐条对照触发路径走读，不以「看起来可能有问题」立案；下文每条都注明可复现的具体操作。
- `styles.css`（3,532 行）**未逐条视觉审计**，仅核对了跨页面层级（`.modal-mask` z-index 20 / `.game-frame.is-fullscreen` 200 / `.fp-dock` 300）与 `.modal-card` 的 `max-height:85vh + overflow:auto`，结论：层级与长列表滚动都没问题。
- `admin-frontend/`、`desktop/`、`backend/` 未纳入本次审查（独立进程/独立仓库），如需要另开一轮。

---

## 2. 结论摘要

| ID | 级别 | 位置 | 一句话 |
|---|---|---|---|
| P-01 | 高 | `GamePage.tsx:503` | 永久有效的会话 token 被拼进 iframe URL |
| P-02 | 高 | `App.tsx:41-57` + `api.ts:22-49` | 后端未就绪也当成登录失效，清空登录态 |
| P-03 | 高 | `StudentRosterPage.tsx:347` / `:256`、`StudentPointsPage.tsx:330` | 数字输入框无法清空，误触把积分写回 0 |
| P-04 | 中 | `StudentRosterPage.tsx:42-72`、`StudentPointsPage.tsx:75-105`、`ClassesPage.tsx:18-31` | 切班级/搜索无竞态保护，旧响应覆盖新结果 |
| P-05 | 中 | `GamePage.tsx:195-202` | `studentId` 未做类型归一，字符串 id 会导致成绩静默丢失 |
| P-06 | 中 | `StorePage.tsx:97-99` | 「有更新」用 `!==` 判断，会把已装的新版本降级覆盖 |
| P-07 | 中 | `SettingsPage.tsx:123-131` | 悬浮球开关乐观更新，失败不回滚 |
| P-08 | 中 | `StorePage.tsx:77-108` | 云端 token 失效后卡在「已登录」视图，无重登入口 |
| P-09 | 中低 | `LoginPage.tsx:204-214` | 没有 `<form>`，回车不能提交登录 |
| P-10 | 低 | `GamePage.tsx:246-248`、`DashboardPage.tsx:29-53` 等 | 错误提示只增不减；结算失败的「结算中…」永久停留 |
| P-11 | 低 | `api.ts:195-203` | 下载后立刻 `revokeObjectURL`，部分内核会中断下载 |
| P-12 | 低 | `api.ts:22-49` | 请求无超时，后端 hang 住时页面永久 loading |
| P-13 | 低 | `GamePage.tsx:603`、`DashboardPage.tsx:187-193` | 通用游戏页写死「拼图活动完成」；筛选为空时文案误导 |

---

## 3. 逐条问题与补丁

### P-01【高】会话 token 出现在游戏 iframe 的 URL 里

**位置**：`frontend/src/pages/GamePage.tsx:500-504`（拼装），`:658-663`（落到 `src`）

```tsx
const playUrl =
  started && installedGame && entry
    ? `/api/v1/plugin/${encodeURIComponent(token)}/${encodeURIComponent(gameCode)}/${encodeURIComponent(installedGame.installedVersion)}/${entry}`
    : null;
```

**现象**：老师点「开始游戏」后，主登录 token 变成 iframe 的 URL 路径段。

**触发条件**：任意积分型/展示型游戏启动（`started === true` 即触发，无需特殊操作）。

**影响**（按严重度排序）：

1. token 进入 `iframe.src` 的 DOM 与**浏览 history**，截图、录屏、投屏演示、远程协助时可直接被看到；
2. 游戏包内若加载任何**外链资源**（字体、CDN、统计脚本、`<img>`），请求的 `Referer` 头会带上整条 URL，**把永久有效的 token 发给第三方**；
3. `AuthService` 的会话过期时间是 `9999-01-01`（`AuthService.java:36`），token 不会自然失效，一旦泄露只能靠手动登出收场。

**成因**：`/api/v1/plugin/**` 在 `AuthFilter` 的白名单里（第 80 行），因为 `<iframe src>` 无法携带 `Authorization` 头，
于是把「认证信息」退化成了「URL 里的明文」。这是能力缺失导致的妥协，不是笔误。

**修改方案**：

- 立即缓解（前端 + 后端各一行，本次可直接落地）：禁止该路径带上 Referer。
- 根治（建议排期）：后端增加「一次性插件票据」接口，`POST /api/v1/plugin-ticket`（带 Bearer）返回 60 秒、绑定 `gameCode+version` 的
  ticket，`/plugin/{ticket}/...` 只认 ticket；前端把 `token` 换成 `ticket`，每局开一次。

**补丁（缓解，立即生效）**：

```diff
--- a/frontend/src/pages/GamePage.tsx
+++ b/frontend/src/pages/GamePage.tsx
@@ -658,6 +658,7 @@
           <iframe
             ref={iframeRef}
             key={`${playUrl}#${reloadNonce}`}
             title={installedGame.name}
             src={playUrl}
             allowFullScreen
+            referrerPolicy="no-referrer"
             style={{
```

```diff
--- a/backend/src/main/java/com/eduplay/game/PluginContentController.java
+++ b/backend/src/main/java/com/eduplay/game/PluginContentController.java
@@ -41,6 +41,8 @@
         headers.setContentType(MediaType.parseMediaType(pluginFile.mediaType()));
         headers.setCacheControl(CacheControl.noStore());
+        // 该 URL 路径里带会话 token：禁止它通过 Referer 泄漏给游戏包引用的任何外链资源
+        headers.set("Referrer-Policy", "no-referrer");
         headers.setContentLength(bytes.length);
```

> 说明：`referrerPolicy` 只约束「加载 iframe 这一次」的 Referer；游戏包内部再发起的请求由**游戏文档自己的**策略决定，
> 所以后端那条响应头是必须的，两条一起上才闭环。

---

### P-02【高】后端还没就绪，被当成「登录失效」，本地登录态被清空

**位置**：`frontend/src/App.tsx:41-57`；抛错源 `frontend/src/api.ts:36-46`

```tsx
useEffect(() => {
  if (!token) return;
  getCurrentUser(token)
    .then((currentUser) => { setUser(currentUser); localStorage.setItem(...); })
    .catch(() => {                       // ← 任何异常都走这里
      setUser(null);
      setToken(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    });
}, [token]);
```

**现象**：刷新/启动瞬间只要 `GET /api/v1/auth/me` 没拿到 JSON，就无条件登出并**删除** localStorage 里的 token。

**触发条件**（都是日常会遇到的）：

- 桌面壳刚拉起 jar，页面已经能渲染但后端 7070 还在做 Flyway 迁移 → `fetch` 拿到空响应 → `api.ts:39` 抛「服务无响应」→ 登出；
- 后端自愈重启、端口从 7070 漂到 7071 的那几秒；
- 校园网代理/杀软短暂拦截 `127.0.0.1`。

**影响**：老师看到登录页，且 token 已被删除，**必须重新输密码**（还带走了「记住密码」之外的一切临时状态）。
更矛盾的是：真正该登出的场景（运行中 token 失效，后端明确返回 401）反而**不登出**——页面只挂一条红色错误，人还停在「已登录」界面。

**成因**：`request()` 把所有失败压成同一种 `Error(message)`，丢掉了 HTTP 状态码，调用方无法区分「401 请重新登录」和「网络断了先等等」。

**修改方案**：错误类型带上 `status`；只有 401/403 才清凭证，其余保留登录态（让页面自己的错误条去提示）。

**补丁 1/2 — `api.ts` 引入带状态码的错误**：

```diff
--- a/frontend/src/api.ts
+++ b/frontend/src/api.ts
@@
 const BASE_URL = "/api/v1";
 const CLOUD_BASE_URL = "/cloud-api/api/v1";
 
+/** 带 HTTP 状态码的接口错误：调用方据此区分「凭证失效」与「服务不可达」。 */
+export class ApiError extends Error {
+  readonly status: number;
+  readonly code: string;
+
+  constructor(message: string, status: number, code = "") {
+    super(message);
+    this.name = "ApiError";
+    this.status = status;
+    this.code = code;
+  }
+}
+
 async function request<T>(
   path: string,
   options?: RequestInit,
   baseUrl: string = BASE_URL
 ): Promise<T> {
   const isFormData = options?.body instanceof FormData;
   const response = await fetch(`${baseUrl}${path}`, {
     ...options,
     headers: {
       ...(isFormData ? {} : { "Content-Type": "application/json" }),
       ...(options?.headers ?? {})
     }
   });
 
-  let body: ApiResponse<T>;
+  let body: ApiResponse<T> | null = null;
   try {
     body = (await response.json()) as ApiResponse<T>;
   } catch {
     // 响应体为空或非 JSON：多为服务未启动、代理目标不可达
-    throw new Error("服务无响应，请确认后端服务已启动");
+    throw new ApiError("服务无响应，请确认后端服务已启动", response.status);
   }
 
-  if (!response.ok || !body.success) {
-    throw new Error(body.message || "请求失败");
+  if (!response.ok || !body?.success) {
+    throw new ApiError(
+      body?.message || "请求失败",
+      response.status,
+      body?.code ?? ""
+    );
   }
 
   return body.data;
 }
```

**补丁 2/2 — `App.tsx` 只在 401/403 时登出**：

```diff
--- a/frontend/src/App.tsx
+++ b/frontend/src/App.tsx
@@
-import { getCurrentUser, logout } from "./api";
+import { ApiError, getCurrentUser, logout } from "./api";
@@
   useEffect(() => {
-    if (!token) {
-      return;
-    }
-
-    getCurrentUser(token)
-      .then((currentUser) => {
-        setUser(currentUser);
-        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
-      })
-      .catch(() => {
-        setUser(null);
-        setToken(null);
-        localStorage.removeItem(USER_STORAGE_KEY);
-        localStorage.removeItem(TOKEN_STORAGE_KEY);
-      });
+    if (!token) {
+      return;
+    }
+    let cancelled = false;
+
+    getCurrentUser(token)
+      .then((currentUser) => {
+        if (!cancelled) {
+          setUser(currentUser);
+        }
+      })
+      .catch((err: unknown) => {
+        if (cancelled) {
+          return;
+        }
+        // 只有「服务明确说这个 token 无效」才清本地登录态。
+        // 后端还没起来 / 端口正在切换时 fetch 也会 reject，那时登出是错的：
+        // 老师只是多等了两秒，却被迫重新输密码（token 还会被删掉）。
+        const unauthorized =
+          err instanceof ApiError && (err.status === 401 || err.status === 403);
+        if (unauthorized) {
+          setUser(null);
+          setToken(null);
+        }
+      });
+
+    return () => {
+      cancelled = true;
+    };
   }, [token]);
```

> 拆分理由：`localStorage` 的写入本来就由下面两个 `useEffect([user])` / `useEffect([token])` 负责，这里不必重复写。

**可选加固（运行中的 401 也能自动登出）**：在 `request()` 判定 401 后 `window.dispatchEvent(new Event("eduplay:unauthorized"))`，
`App` 里挂一个监听调用 `handleLogout()`。工作量约 10 行，建议与本条一起做。

---

### P-03【高】数字输入框「清不空」，一次误触把学生积分写回 0

**位置**：

| 位置 | 字段 | 危险度 |
|---|---|---|
| `StudentRosterPage.tsx:342-349`（`handleUpdateStudent` 提交 `totalPoints`） | 修改学生 → 积分 | **高：直接清零已有积分** |
| `StudentRosterPage.tsx:253-258`（`initialPoints`） | 添加学生 → 初始积分 | 中：静默变 0 |
| `StudentPointsPage.tsx:325-332`（`amount`） | 调整积分 → 变动值 | 中：0 被后端拒（`StudentService.java:287`），只得到一句报错 |
| `SeatingPage.tsx:233-236 / 245-248` | 排数 / 列数 | 低：清空即 0，整块座位表消失 |

**现象**：受控 `input type="number"` 直接把 `event.target.value` 交给 `Number()`，而 `Number("") === 0`。
于是「清空」这个动作被解释成「填 0」，输入框会立刻把 `0` 显示回来——**这个字段永远无法留空**。

**触发条件（具体操作）**：
老师在「学生管理」里点某学生的「修改」，只想改姓名错字，手滑点进「积分」框按了一次 Backspace →
输入框显示 `0` → 点「保存」→ `PUT /students/{id}` 带 `totalPoints: 0`。

**影响**：`StudentService.updateStudent` 会把 `totalPoints` 当作**绝对值**写入，并补一条
`MANUAL_DEDUCT / EDIT_STUDENT` 流水（`StudentService.java:253-266`）。学生累积的课堂积分被清零，
排行榜、班级平均分、最高分同步失真；虽然流水留痕可手工补回，但老师通常不知道发生过这件事。
`StudentPointsPage` 那处同理：清空后点「确认」只能得到「积分变动不能为0」的报错，且该报错会一直挂在页面上（见 P-10）。

**成因**：把「编辑中的文本」和「业务数值」合成一个 state，且没有中间校验层。同类写法在项目里有 8 处
（`grep -n "Number(event.target.value)"`），其中 `StudentPointsPage:330`、`StudentRosterPage:256/347` 三处的 0 有业务含义。

**修改方案**：编辑态一律用 `string`，只在提交时解析并校验；解析失败就报错不提交；`0` 与「未填」严格区分。

**补丁 3/3 — `StudentRosterPage.tsx`**：

```diff
--- a/frontend/src/pages/StudentRosterPage.tsx
+++ b/frontend/src/pages/StudentRosterPage.tsx
@@
-  const [newPoints, setNewPoints] = useState(0);
+  // 编辑态用字符串：受控 number 输入框里 "" 会被 Number() 变成 0，
+  // 结果是"清空"= "填 0"，既清不掉，又能把已有积分写回 0。
+  const [newPoints, setNewPoints] = useState("0");
@@
-  const [editPoints, setEditPoints] = useState(0);
+  const [editPoints, setEditPoints] = useState("");
@@
   async function handleAddStudent() {
     setError("");
+    const parsedPoints = Number(newPoints.trim() === "" ? "0" : newPoints);
+    if (!Number.isFinite(parsedPoints)) {
+      setError("初始积分请填写数字");
+      return;
+    }
     try {
       await addStudent(token, {
         name: newName,
         studentNo: newStudentNo,
         className: newClassName,
-        initialPoints: newPoints
+        initialPoints: Math.trunc(parsedPoints)
       });
       setNewName("");
       setNewStudentNo("");
       setNewClassName("");
-      setNewPoints(0);
+      setNewPoints("0");
@@
   function openEdit(student: Student) {
     setEditTarget(student);
     setEditName(student.name);
     setEditStudentNo(student.studentNo);
     setEditClassName(student.className ?? "");
-    setEditPoints(student.totalPoints);
+    setEditPoints(String(student.totalPoints));
   }
@@
   async function handleUpdateStudent() {
     if (!editTarget) {
       return;
     }
+    const parsedPoints = Number(editPoints.trim());
+    if (editPoints.trim() === "" || !Number.isFinite(parsedPoints)) {
+      setError("积分请填写数字（不能留空）");
+      return;
+    }
+    const nextPoints = Math.trunc(parsedPoints);
+    if (nextPoints === 0 && editTarget.totalPoints !== 0) {
+      const confirmed = window.confirm(
+        `确定把 ${editTarget.name} 的积分从 ${editTarget.totalPoints} 改成 0 吗？此操作会写入扣分记录。`
+      );
+      if (!confirmed) {
+        return;
+      }
+    }
     try {
       await updateStudent(token, editTarget.id, {
         name: editName,
         studentNo: editStudentNo,
         className: editClassName,
-        totalPoints: editPoints
+        totalPoints: nextPoints
       });
@@
           <input
             type="number"
             value={newPoints}
-            onChange={(event) => setNewPoints(Number(event.target.value))}
+            onChange={(event) => setNewPoints(event.target.value)}
             placeholder="初始积分"
           />
@@
               <input
                 type="number"
                 value={editPoints}
-                onChange={(event) => setEditPoints(Number(event.target.value))}
+                onChange={(event) => setEditPoints(event.target.value)}
               />
```

**补丁 — `StudentPointsPage.tsx`（改动值）**：

```diff
--- a/frontend/src/pages/StudentPointsPage.tsx
+++ b/frontend/src/pages/StudentPointsPage.tsx
@@
-  const [adjustAmount, setAdjustAmount] = useState(0);
+  const [adjustAmount, setAdjustAmount] = useState("");
@@
   async function handleAdjustPoints() {
     if (!adjustTarget) {
       return;
     }
+    const amount = Number(adjustAmount.trim());
+    if (adjustAmount.trim() === "" || !Number.isFinite(amount) || amount === 0) {
+      setError("积分变动请填写非 0 的数字");
+      return;
+    }
     try {
       await adjustStudentPoints(token, adjustTarget.id, {
-        amount: adjustAmount,
+        amount: Math.trunc(amount),
         reason: adjustReason
       });
       setAdjustTarget(null);
-      setAdjustAmount(0);
+      setAdjustAmount("");
       setAdjustReason("");
@@
               <input
                 type="number"
                 value={adjustAmount}
-                onChange={(event) => setAdjustAmount(Number(event.target.value))}
+                onChange={(event) => setAdjustAmount(event.target.value)}
               />
@@
-            <button className="primary" onClick={handleAdjustPoints}>
+            <button
+              className="primary"
+              disabled={
+                !adjustAmount.trim() || Number(adjustAmount) === 0
+              }
+              onClick={handleAdjustPoints}
+            >
               确认
             </button>
```

---

### P-04【中】切班级 / 连续搜索无竞态保护，旧响应会覆盖新结果

**位置**：`StudentRosterPage.tsx:42-55`（`reload`）与 `:69-72`（effect）；`StudentPointsPage.tsx:75-88` 与 `:102-105`；`ClassesPage.tsx:18-31`

**现象**：`reload()` 直接 `setStudents(await listStudents(...))`，既不取消旧请求，也不校验「回来的还是不是当前这次」。

**触发条件**：班级 tab 快速连点（A → B），或搜索框连续回车两次（`"王"` → `"王小明"`）。
本机后端虽快，但名单 200+ 行 + 「导入学生」刚写完库时，A 的响应完全可能晚于 B。

**影响**：tab 高亮停在 B 班，表格里却是 A 班学生。老师据此点名、加分 → **给错班的学生记分**。
`StudentPointsPage` 同理：搜索结果与关键词不一致，导出的 Excel 也会带着错误的筛选结果。

**成因**：项目里其实有两种写法并存——`DashboardPage`/`GamePage`/`RollCallPage`/`SeatingPage`/`StorePage` 都有
`let cancelled = false` 守卫，而这 3 个页面漏了。不是设计取舍，是遗漏。

**修改方案**：用单调递增的序号做「最后一次请求胜出」，比 `cancelled` 更贴合「同一个 effect 内多次触发」的场景
（`cancelled` 只在 effect 清理时置位，连点两次 tab 时两次调用共享同一个 flag，拦不住）。

**补丁（`StudentRosterPage.tsx`，另两处照抄）**：

```diff
--- a/frontend/src/pages/StudentRosterPage.tsx
+++ b/frontend/src/pages/StudentRosterPage.tsx
@@
 import { Download, Upload } from "lucide-react";
-import { useEffect, useRef, useState } from "react";
+import { useEffect, useRef, useState } from "react";
@@
   const [editPoints, setEditPoints] = useState("");
 
+  // 「最后一次请求胜出」：连点班级 tab / 连续回车搜索时，
+  // 先发的请求可能后回来，不能让它覆盖后发请求的结果。
+  const requestSeq = useRef(0);
+
   async function reload() {
+    const seq = ++requestSeq.current;
     setLoading(true);
     try {
       const result =
         selectedClass === "ALL"
           ? await listStudents(token)
           : await listStudents(token, { className: selectedClass });
-      setStudents(result);
+      if (seq === requestSeq.current) {
+        setStudents(result);
+      }
     } catch (err) {
-      setError(err instanceof Error ? err.message : "加载学生名单失败");
+      if (seq === requestSeq.current) {
+        setError(err instanceof Error ? err.message : "加载学生名单失败");
+      }
     } finally {
-      setLoading(false);
+      if (seq === requestSeq.current) {
+        setLoading(false);
+      }
     }
   }
```

`StudentPointsPage.tsx` 的 `reload()`、`ClassesPage.tsx` 的 `load()` 用同一模式；
`ClassesPage` 还有一处附带修复：`load()` 开头没有 `setError("")`，失败后即使重试成功，红条也留着（见 P-10）。

---

### P-05【中】`GAME_COMPLETE` 的 `studentId` 未归一化，字符串 id 会导致成绩静默丢失

**位置**：`GamePage.tsx:195-202`

```tsx
const target =
  payload.studentId != null
    ? selectedStudents.find((student) => student.id === payload.studentId) ?? null
    : selectedStudents.length === 1 ? selectedStudents[0] : null;
if (!target) { setError("游戏返回的学生不在本次选择名单中，无法结算积分"); return; }
```

**现象**：TS 类型写着 `studentId?: number`，但这是**跨 iframe 的 postMessage**，类型在运行期没有任何约束。
游戏若发 `{"studentId": "12"}`（模板字符串拼出来的 id 很常见），`student.id === "12"` 恒为 `false`。

**触发条件**：任何第三方游戏包在 `GAME_COMPLETE` 里用字符串传 `studentId`。

**影响**：命中 `!target` 分支 → 弹「游戏返回的学生不在本次选择名单中」，**本局成绩不入库**，
而错误信息指向「名单不对」，排查方向被带偏。同一文件 `:382-386` 处理 `GAME_SESSION_COMPLETE` 时
却做了 `typeof item.studentId === "number"` 的严格过滤——两套契约在同一文件内打架，说明这里是漏写而不是有意。

**成因**：只信任了 TS 类型，没有对不可信消息做运行期归一化。

**修改方案**：显式把 `unknown` 归一成 `number | null`，再走同一套匹配逻辑。

**补丁**：

```diff
--- a/frontend/src/pages/GamePage.tsx
+++ b/frontend/src/pages/GamePage.tsx
@@
-      const target =
-        payload.studentId != null
-          ? selectedStudents.find(
-              (student) => student.id === payload.studentId
-            ) ?? null
-          : selectedStudents.length === 1
-            ? selectedStudents[0]
-            : null;
+      // postMessage 的内容不受 TS 约束，运行期一律归一化：
+      // 游戏包用 "12"（字符串）传 id 时，严格相等会让成绩静默丢失。
+      const rawStudentId: unknown = payload.studentId;
+      const studentId =
+        typeof rawStudentId === "number"
+          ? rawStudentId
+          : typeof rawStudentId === "string" && rawStudentId.trim() !== ""
+            ? Number(rawStudentId)
+            : null;
+      const target =
+        studentId != null && Number.isFinite(studentId)
+          ? selectedStudents.find((student) => student.id === studentId) ?? null
+          : selectedStudents.length === 1
+            ? selectedStudents[0]
+            : null;
```

> 顺带一提：`selectedStudents.length > 1` 且游戏没传 `studentId` 时，当前是「报错不结算」。
> 这个选择本身合理（宁可拒绝也不错记），保留不动。

---

### P-06【中】「有更新」用字符串不等判断，会把已装的新版本降级覆盖

**位置**：`StorePage.tsx:97-99`

```tsx
updateAvailable: Boolean(local && local.installedVersion !== game.version)
```

**现象**：只要云端版本与本地版本「不相等」就亮「更新到 x.y.z」按钮，不判断谁更新。

**触发条件**：老师曾手动导入过 `1.10.0` 的 zip（`DashboardPage` 的「手动导入游戏包」支持），
而云端商城仍是 `1.9.0`；或者云端回滚过版本。

**影响**：卡片显示「更新到 1.9.0」，点下去 `handleInstall` 会**直接覆盖安装**低版本。
若该版本之后有过插件包 schema 变更，可能出现游戏读不了新数据；老师也会以为「更新」只会前进。

**成因**：把「不相等」当成了「有更新」，缺一个语义化版本比较。项目里对版本号的比较一直是薄弱点
（后端 `findFirstByGameIdOrderByVersionDesc` 也是字符串排序），前端这处是同一类问题的另一面。

**修改方案**：加 `compareVersion`，仅在「云端 > 本地」时才提示更新；本地更新时显示「已是最新」。

**补丁**：

```diff
--- a/frontend/src/pages/StorePage.tsx
+++ b/frontend/src/pages/StorePage.tsx
@@
 const CLOUD_TOKEN_KEY = "eduplay.cloud.token";
 const CLOUD_USER_KEY = "eduplay.cloud.user";
 
+/**
+ * 语义化版本比较（不含预发布标签语义）：a > b 返回正数，相等返回 0。
+ * 支持 1.9.0 / 1.10.0 这类「位数不对齐」的写法——直接 !== 比较会把
+ * 「本地已装 1.10.0、云端还是 1.9.0」误判成有更新，从而提示降级。
+ */
+function compareVersion(a: string, b: string): number {
+  const parse = (value: string) =>
+    value
+      .split(/[.+-]/)
+      .map((part) => Number.parseInt(part, 10))
+      .filter((part) => Number.isFinite(part));
+  const left = parse(a);
+  const right = parse(b);
+  const length = Math.max(left.length, right.length);
+  for (let index = 0; index < length; index += 1) {
+    const diff = (left[index] ?? 0) - (right[index] ?? 0);
+    if (diff !== 0) {
+      return diff;
+    }
+  }
+  return 0;
+}
+
 function readCloudUser(): User | null {
@@
-          updateAvailable: Boolean(
-            local && local.installedVersion !== game.version
-          )
+          // 只有云端确实更新时才提示升级；本地更新时不提示降级
+          updateAvailable: Boolean(
+            local &&
+              local.installedVersion &&
+              compareVersion(game.version, local.installedVersion) > 0
+          )
```

---

### P-07【中】悬浮球开关乐观更新，失败不回滚

**位置**：`SettingsPage.tsx:123-131`

```tsx
async function handleBallModeChange(next: boolean) {
  setBallMode(next);                     // ← 先改 UI
  try {
    await window.eduplayDesktop?.setDesktopSetting("ballMode", next);
    setNotice(...);
  } catch {
    setError(t("settings.message.failed"));   // ← 只报错，UI 仍显示已切换
  }
}
```

**触发条件**：桌面壳主进程忙/IPC 超时/写配置文件失败（便携版 U 盘拔出、`app_settings` 目录只读）。

**影响**：按钮显示「已开启」，但主进程策略没变——老师关窗时程序**直接退出**而不是收成悬浮球，
正在进行的游戏与本地服务一起没掉。这正是悬浮球最容易造成「数据没了」的场景。

**成因**：把「请求」当成了「结果」，catch 分支只做提示，没有回到前一状态。

**补丁**：

```diff
--- a/frontend/src/pages/SettingsPage.tsx
+++ b/frontend/src/pages/SettingsPage.tsx
@@
   async function handleBallModeChange(next: boolean) {
+    const previous = ballMode;
+    const clearFeedback = () => {
+      setNotice("");
+      setError("");
+    };
+    clearFeedback();
     setBallMode(next);
     try {
       await window.eduplayDesktop?.setDesktopSetting("ballMode", next);
       setNotice(next ? t("settings.desktop.ballOn") : t("settings.desktop.ballOff"));
     } catch {
-      setError(t("settings.message.failed"));
+      // 设置没落盘就必须把开关拨回去：留在"已开启"的假象上，
+      // 老师会以为关窗只是收起悬浮球，实际直接退出程序。
+      setBallMode(previous);
+      setError(t("settings.message.failed"));
     }
   }
```

---

### P-08【中】云端 token 失效后卡在「已登录」视图，没有重登入口

**位置**：`StorePage.tsx:77-108`（`loadStore` 的 catch）与登录门 `:237`

**现象**：`cloudToken` 存在（localStorage 里还有），但云端已经把它作废时：
- `cloudToken && cloudUser` 判定为真 → **不进登录卡**；
- `cloudListStoreGames` 抛 401 → 只会 `setError("登录状态已失效，请重新登录")`；
- 页面上没有任何「重新登录」按钮，唯一出路是先点右上角「退出云端」，**而错误提示并没有告诉用户这一步**。

**触发条件**：云端后端重装/清库、云端教师改密码、换机器后云端会话被回收。代理层会原样透传 401
（`CloudApiProxyController.java:78`），所以前端拿到的确实是 401，只是没人处理。

**影响**：商城整块不可用，且用户不知道怎么办——支持成本高（「商城一直报错」）。

**成因**：云端会话是第二套凭证（`eduplay.cloud.token`），但只做了「写入」和「手动退出」，没有「失效即退回登录」。

**补丁**：

```diff
--- a/frontend/src/pages/StorePage.tsx
+++ b/frontend/src/pages/StorePage.tsx
@@
-import {
+import {
+  ApiError,
   cloudDownloadPackage,
@@
     } catch (err) {
-      setError(err instanceof Error ? err.message : "加载云端商城失败");
+      // 云端会话是独立的一套凭证：失效时要退回登录卡，
+      // 否则页面停在"已登录"视图里，只挂一条错误、没有任何重登入口。
+      if (err instanceof ApiError && err.status === 401) {
+        handleCloudLogout();
+        setCloudError("云端登录已失效，请重新登录");
+        return;
+      }
+      setError(err instanceof Error ? err.message : "加载云端商城失败");
     } finally {
       setLoading(false);
     }
```

> 注意顺序：`handleCloudLogout()` 内部会 `setGames([])`，而 `loadStore` 的 `finally` 仍会 `setLoading(false)`，
> 两者不冲突；`handleCloudLogout` 定义在下方但同为函数声明，存在提升，可直接调用。

---

### P-09【中低】登录页没有 `<form>`，按回车不能登录

**位置**：`LoginPage.tsx:112-214`（三个 `label+input` 与末尾的裸 `button`）

**现象**：输入用户名、密码后按 Enter —— 页面毫无反应。整页没有 `<form>`，浏览器不会替你把回车变成提交。

**触发条件**：任何习惯「敲完密码按回车」的老师（这是绝大多数人的肌肉记忆），在有输入法的中文键盘下更容易出现。

**影响**：被当成「卡住了/按键没反应」，随后反复点击或刷新；也是「登录页有时候不好使」这类反馈的常见来源。

**成因**：登录卡是 div 拼的，`handleSubmit` 只能靠 `onClick` 触发。

**补丁**：

```diff
--- a/frontend/src/pages/LoginPage.tsx
+++ b/frontend/src/pages/LoginPage.tsx
@@
       <section className="auth-form-side">
         <div className="auth-form-card">
+          {/* 用 form 包住：浏览器才会把「回车」变成提交，
+              否则老师敲完密码按 Enter 毫无反应，会以为页面卡死。 */}
+          <form
+            onSubmit={(event) => {
+              event.preventDefault();
+              if (!submitting) {
+                void handleSubmit();
+              }
+            }}
+          >
           <div className="auth-form-header">
@@
           <button
             className="primary auth-submit"
+            type="submit"
             disabled={submitting}
-            onClick={handleSubmit}
           >
@@
           </button>
+          </form>
         </div>
       </section>
```

> 配套建议（同一处改动，成本 0）：用户名 `autoComplete="username"`、密码 `autoComplete="current-password"`，
> 让浏览器/系统密码管理器能正确识别。

---

### P-10【低】错误提示只增不减；结算失败的「结算中…」永久停留

**位置**（同一模式的多处）：

| 位置 | 现象 |
|---|---|
| `GamePage.tsx:246-248` | `submitGameScore` 成功后不清 `error`，上一局的错误红条一直挂着 |
| `GamePage.tsx:627-631` | 结算失败时 `totalPoints == null` → 表格显示「结算中…」，但**没有任何重试路径**，永远停在这 |
| `StudentPointsPage.tsx:75-88` | `reload()` 成功不清 `error`，改积分失败的红条会留到下一次操作 |
| `DashboardPage.tsx:29-53` | 列表加载成功也不清 `error` |
| `ClassesPage.tsx:18-27` | 同上 |

全项目 `setError(` 出现 61 次，`setError("")` 只有 23 次，且集中在「提交前清空」，没有「成功后清空」。

**影响**：失败一次之后界面永久带红条，老师无法判断「这次到底成功了没有」；
`GamePage` 的「结算中…」更严重——看起来像还在算，实际已经是终态。

**成因**：错误状态是页面级的单一 string，缺少「成功即清除」的约定。

**补丁（以 `GamePage` 为例，其余同构）**：

```diff
--- a/frontend/src/pages/GamePage.tsx
+++ b/frontend/src/pages/GamePage.tsx
@@
         const scoreResult: GameScoreResult = await submitGameScore(
           token,
           gameCode,
           {
             studentId: target.id,
             score: Math.round(score),
             roundId
           }
         );
+        setError(""); // 上一局的失败提示不该留到这一局
         setRoundLogs((current) =>
@@
                     <td>
-                      {round.totalPoints != null
-                        ? round.totalPoints
-                        : "结算中…"}
+                      {round.totalPoints != null
+                        ? round.totalPoints
+                        : round.recorded === false
+                          ? "未计入"
+                          : "结算中…"}
                     </td>
```

> 「未计入」用于 `scoreResult.recorded === false`（后端幂等命中等情形），与「还在算」区分开。

---

### P-11【低】下载后立刻 `revokeObjectURL`

**位置**：`api.ts:195-203`

```ts
anchor.click();
anchor.remove();
URL.revokeObjectURL(url);   // ← 同步撤销
```

**影响**：Chromium 内核（当前 Electron 目标）通常来得及接管，实测可用；但 Firefox / 部分 WebView 会把下载中断成
0 字节文件。这属于「今天没问题、换个内核就翻车」的隐患，改一行就能消掉。

**补丁**：

```diff
--- a/frontend/src/api.ts
+++ b/frontend/src/api.ts
@@
   document.body.appendChild(anchor);
   anchor.click();
   anchor.remove();
-  URL.revokeObjectURL(url);
+  // 同步撤销在部分内核里会把还没开始的下载掐断（落成 0 字节文件）
+  window.setTimeout(() => URL.revokeObjectURL(url), 0);
```

---

### P-12【低】请求无超时，后端 hang 住时页面永久 loading

**位置**：`api.ts:22-34`

**触发条件**：后端进程还在但线程池被长事务占满（例如 200MB 的插件包导入）、或端口被别的进程占住形成半开连接。
`fetch` 默认没有超时，`await` 会一直挂着。

**影响**：`loading` 永远为 `true`，页面停在「正在加载游戏…」，设置页那种「重新加载界面」的按钮正好在别的页面，
老师只能强退程序。

**补丁**：

```diff
--- a/frontend/src/api.ts
+++ b/frontend/src/api.ts
@@
   const isFormData = options?.body instanceof FormData;
   const response = await fetch(`${baseUrl}${path}`, {
     ...options,
+    // 默认 20 秒；导入插件包那类大请求由调用方显式传更长的 signal 覆盖
+    signal: options?.signal ?? AbortSignal.timeout(20_000),
     headers: {
       ...(isFormData ? {} : { "Content-Type": "application/json" }),
       ...(options?.headers ?? {})
     }
   });
```

> `AbortSignal.timeout` 在 Electron 43 / Chromium 130+ 全部可用；超时会以 `DOMException: TimeoutError` 抛出，
> 若希望提示更友好，可在 `request` 外层 catch 里把它转成 `ApiError("请求超时，请检查后端是否卡住", 0)`。

---

### P-13【低】通用游戏页写死「拼图活动完成」；筛选为空时文案误导

**位置 1**：`GamePage.tsx:601-606`

```tsx
<h2>拼图活动完成</h2>
<p>共 {roundLogs.length} 名学生完成，按用时从少到多排列：</p>
```

**现象**：这是**所有**游戏共用的结算页。玩「山河三消」「寰宇地球仪」「河流湖泊」时，结算页仍写「拼图活动完成」。

**影响**：多学科平台出现「地理老师玩三消，结算写拼图」的错位，直接削弱专业感；也是平台化叙事里最容易被抓住的一处。

**补丁**：

```diff
--- a/frontend/src/pages/GamePage.tsx
+++ b/frontend/src/pages/GamePage.tsx
@@
         <section className="result-card">
-          <h2>拼图活动完成</h2>
+          <h2>{installedGame.name} · 本局完成</h2>
           <p>
             共 {roundLogs.length} 名学生完成，按用时从少到多排列：
           </p>
```

**位置 2**：`DashboardPage.tsx:187-193`

```tsx
{filteredGames.length === 0 ? (
  <div className="empty-state"><p>你还没有安装任何游戏。</p> …
```

**现象**：选了标签筛选后结果为空，也显示「你还没有安装任何游戏」，与事实矛盾（明明装了 13 个，只是没有这个标签）。

**补丁**：

```diff
--- a/frontend/src/pages/DashboardPage.tsx
+++ b/frontend/src/pages/DashboardPage.tsx
@@
         {filteredGames.length === 0 ? (
           <div className="empty-state">
-            <p>你还没有安装任何游戏。</p>
-            <Link className="primary button-link" to="/store">
-              前往游戏商城
-            </Link>
+            {selectedTag ? (
+              <>
+                <p>没有带「{selectedTag}」标签的游戏。</p>
+                <button
+                  className="secondary"
+                  type="button"
+                  onClick={() => setSelectedTag("")}
+                >
+                  清除筛选
+                </button>
+              </>
+            ) : (
+              <>
+                <p>你还没有安装任何游戏。</p>
+                <Link className="primary button-link" to="/store">
+                  前往游戏商城
+                </Link>
+              </>
+            )}
           </div>
```

---

## 4. 已核查并**排除**的疑点（附证据）

审查里最容易误报的几处，逐条给了结论，避免后续重复排查：

| 疑点 | 结论 | 证据 |
|---|---|---|
| 导入模板用 `<a href="/api/v1/students/import/template">` 不带 token，会不会 401？ | **没问题**，该路径在白名单里 | `AuthFilter.java:76`，注释明确写了「前端用 `<a href>` 直接下载」 |
| `getInstalledManifest` 直接 `response.json()`，没解 `ApiResponse` 包装，是不是漏了？ | **没问题**，该端点返回裸 JSON | `GameStoreController.java:102-109` `ResponseEntity<String>` + `application/json` |
| 游戏双击「完成」会不会重复加分？ | **不会**，后端按 `gameCode:studentId:roundId` 幂等 | `GameScoreService.java:71,103` |
| 名单改了浮窗不刷新？ | **已修**，`invalidateRosterAfter` 只写在 `api.ts`，`grep` 确认无遗漏调用点 | `rosterStore.ts:53-63` + `api.ts` 6 处包裹 |
| i18n 中英文键会不会缺？ | **对齐**，zh/en 各 86 键、零差集（脚本比对）；代码引用 90 处无缺失键 | `node` 脚本比对 `i18n.tsx` |
| 有没有 XSS 面？ | **没有**，无 `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function`，全部走 JSX 转义；无 `target="_blank"` 外链 | `grep` 全目录零命中 |
| 模态框里积分流水很长会不会溢出不可用？ | **不会**，`.modal-card` 有 `max-height:85vh; overflow:auto` | `styles.css:1300-1301` |
| 全屏时浮窗会不会消失？ | **不会**，portal 宿主随 `fullscreenchange` 切到 `document.fullscreenElement`；z-index 300 vs 全屏层 200 | `FloatingPick.tsx:125-143`、`styles.css:2501-2509` |
| 悬浮球拖动「用着用着变小」还会复发吗？ | **不会**，三道锁（hide 后补尺寸 / useContentSize 固定 56 / 2s watchdog）都在 | `desktop/main.js`（本次范围外，仅确认前端无相关 CSS 阴影/底色） |
| `Number(event.target.value) || 1`（`GamePage:748` 抽取人数）会不会 0 人抽取？ | **没问题**，`|| 1` 已兜底 | `GamePage.tsx:747-749` |

---

## 5. 建议的修复顺序

1. **P-03 → P-02 → P-01**：前两条是「会造成不可逆损害或强制重登」的问题，改动都在 3 行以内；
   P-01 的缓解补丁两行，根治（插件票据）单独排期。
2. **P-04 → P-05 → P-06 → P-08**：都是「结果错误但不会爆炸」，一起改、一起回归（建议回归点：
   连点班级 tab、删除学生后立刻点名、云端清库后进商城）。
3. **P-07 → P-09 → P-10 → P-13 → P-11 → P-12**：体感与健壮性，可并入下一次版本迭代。

改动落地后建议的验收动作（都可在不碰 7070 的临时实例上做）：
`npm run build` 过 `tsc --noEmit`；进入 `学生管理` 清空积分框确认拦得住；登出后把后端停掉再刷新，确认仍停在原页面且有提示；
开任意游戏，DevTools 里确认 `iframe.src` 不含 40 位 token 片段。

---

## 6. 复核与修复记录（2026-11-25）

### 6.1 逐条复核结论

§3 是按第一轮通读写的；落到改代码之前，每条都回到源码重新取证。**有一条需要更正，一条需要降级**，
其余成立。

| ID | 复核结论 | 复核依据 |
|---|---|---|
| P-01 | **成立** | `GamePage.tsx:503` 把 token 拼进 URL；`PluginContentService` 用 `requireUserByToken` 校验该 token，即主登录令牌；`AuthService` 把它签成永久有效 |
| P-02 | **成立** | `api.ts:44` 只抛 `Error(message)`，状态码在抛出时被丢弃；`App.tsx:51-56` 的 `catch` 无条件清凭证 |
| P-03 | **成立** | `StudentRosterPage.tsx:347`、`StudentPointsPage.tsx:330` 均为 `Number(event.target.value)`，`Number("") === 0` |
| P-04 | **成立但范围收窄** | `StudentRosterPage.tsx:42-55`、`StudentPointsPage.tsx:75-88` 的 `reload()` 无序号/取消机制，切班级确实会覆盖；**§3 里把 `ClassesPage.tsx:18-31` 列为同一问题有误**——该页只有 `token` 一个依赖，没有切班级与搜索，不存在并发覆盖 |
| P-05 | **成立** | `GamePage.tsx:198` `student.id === payload.studentId` 严格比较；同类问题还在 `GAME_SESSION_COMPLETE` 的 `typeof item.studentId === "number"` 过滤处（`:381-386`） |
| P-06 | **成立** | `StorePage.tsx:97-99` `!==` 判更新 |
| P-07 | **成立** | `SettingsPage.tsx:123-131` 先 `setBallMode(next)`，`catch` 只 `setError` |
| P-08 | **成立但需降级为「中低」并更正措辞** | §3 说「没有重登入口」不准确：`StorePage.tsx:357` 一直有「退出云端」按钮。真实缺陷是 **401 与其他错误无法区分**，表现为「显示已登录 + 商城空白 + 一条普通报错」 |
| P-09 | **成立** | `LoginPage.tsx:204-214` 提交按钮在 `<div>` 里，`onClick` 之外没有表单语义 |
| P-10 | **成立** | 成功路径从不 `setError("")`；`:627-631` 的「结算中…」在连局模式下永久停留（该模式平台拿不到 `totalPoints`） |
| P-11 | **成立（低）** | `api.ts:203` `click()` 后立刻 `revokeObjectURL`，Firefox/Safari 会丢 blob |
| P-12 | **成立** | `request()` 无 `signal`，后端 hang 住即永久 loading |
| P-13 | **成立** | `GamePage.tsx:603` 写死「拼图活动完成」；`DashboardPage.tsx:187-193` 筛选为空仍说「你还没有安装任何游戏」 |
| **P-14（新增）** | **成立** | `AppLayout.tsx:109` `user.nickname.slice(0,1)` 无兜底。首屏读的是 localStorage 里的 user 缓存，字段缺失就整页白屏，且白屏后连「退出登录」都点不到。**此条是在跑运行验证时真实撞出来的**，不是推测 |

### 6.2 已落地的修改

| ID | 文件 | 改法 |
|---|---|---|
| P-01 | `GamePage.tsx:663`、`PluginContentController.java:44` | iframe 加 `referrerPolicy="no-referrer"`；插件资源响应加 `Referrer-Policy: no-referrer` |
| P-02 | `api.ts:22-52`、`App.tsx:46-62` | 新增 `ApiError { status }`；仅 401/403 清凭证，网络失败保留登录态 |
| P-03 | `StudentRosterPage.tsx`、`StudentPointsPage.tsx` | 编辑态改字符串；空值报错而不是当 0；「原积分改成 0」二次确认；改积分拒绝 0 |
| P-04 | 同上两文件 | `requestSeqRef` 序号守卫，只认最后一次请求，顺带在成功时清错误 |
| P-05 | `GamePage.tsx:195-210`、`:381-400` | `Number()` 归一化后再比对/过滤 |
| P-06 | `StorePage.tsx:37-63` | 新增 `isNewerVersion()` 按段比较，只有云端更新才提示更新 |
| P-07 | `SettingsPage.tsx:123-136` | `catch` 里回滚 `ballMode` |
| P-08 | `StorePage.tsx:190-200`、`handleCloudAuthError` | 401/403 清云端登录态并提示重新登录 |
| P-09 | `LoginPage.tsx` | 卡片 `div` → `form.auth-form-card`（同类名，布局零变化）；tab 按钮补 `type="button"`；提交按钮 `type="submit"` |
| P-10 | `GamePage.tsx`、两处 `reload()` | 成功时清错误；「结算中…」改为 `-` |
| P-11 | `api.ts:209-212` | `revokeObjectURL` 延后 10s |
| P-12 | `api.ts:22-52` | 默认 30s 超时；`FormData` 上传不设超时（避免大包误判失败） |
| P-13 | `GamePage.tsx:601-604`、`DashboardPage.tsx:186-206` | 结算标题改用游戏名；筛选为空时单独文案 + 「清除筛选」 |
| P-14 | `AppLayout.tsx:109-114` | `nickname` 空时回落 `username`，再兜底 `?` |

### 6.3 运行验证（临时实例 7072，未触碰 7070）

前端产物打进临时实例、独立 H2 数据目录、真实注册教师与学生，用 Electron 发**真实键盘事件**驱动，
断言同时查 UI 与后端库值：

| 断言 | 结果 |
|---|---|
| 登录卡片是 `<form>` 元素 | PASS |
| 焦点在密码框按 Enter 能登录（`path === "/"` 且有 token） | PASS |
| 积分弹窗回显原值 100 | PASS |
| 输入框可以被清空（不再回填 0） | PASS |
| 清空后保存被拦下：弹窗不关、报「积分不能为空」、后端仍 100 | PASS |
| 填 0 且取消确认 → 后端仍 100 | PASS |
| 填 0 且确认 → 后端才变 0 | PASS |
| 无效令牌触发 401 → 回 `/login` 且清空 token | PASS |
| 拦截 `/auth/me` 模拟网络失败 → 停在 `/` 、token 保留、侧边栏正常 | PASS |

共 9 + 1 项全 PASS；`tsc --noEmit`、`vite build`、`mvn compile` 均通过。临时实例与临时数据已删除，
`backend/target/classes/static` 里手工放入的产物也已清掉（避免下次打包带上陈旧前端）。

### 6.4 仍未处理

- **P-01 的根治没做**：现在只是「不把 Referer 送出去」，URL 里仍是永久有效的主令牌，
  浏览器历史、代理日志、屏幕共享都会留下它。根治要给插件发**短时效一次性票据**（后端加
  `/plugin-ticket`，前端进入游戏前换取），改动跨前后端，建议单独排期。
- **P-08 的「云端令牌刷新」没做**：现在过期就让用户重登，体验一般但不会再卡在空白商城。
- P-04 只覆盖名单/积分两页；`ClassesPage` 经复核无需处理。
