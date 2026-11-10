# 鉴权实现说明（统一入口 + 对象级权限）

> 面向不熟悉代码的读者：每个文件都会说明「它在干什么」，不需要先读懂全部代码。
> 对应两个服务：`backend`（老师机本地服务，7070）与 `admin-backend`（云端服务，17070）。

---

## 0. 一句话结论

登录认证从「20 多个地方各写一遍」改成「一道闸门统一拦截」，业务代码不再接触 `Authorization` 请求头；
「这条数据是不是你的」这类判断留在业务层，因为过滤器在结构上做不到。

---

## 1. 文件清单

### 1.1 新建的文件

| 路径 | 作用 |
|---|---|
| `backend/src/main/java/com/eduplay/auth/AuthContext.java` | 存放“当前请求是谁”，用 ThreadLocal 实现，业务层随时可取 |
| `backend/src/main/java/com/eduplay/auth/AuthFilter.java` | 统一的认证闸门，保护 `/api/v1/**` |
| `backend/src/test/java/com/eduplay/auth/AuthFilterTest.java` | 13 个回归用例，锁住“默认拒绝”这个性质 |
| `admin-backend/src/main/java/com/eduplay/auth/AuthContext.java` | 同上（云端版本） |
| `admin-backend/src/main/java/com/eduplay/auth/AuthFilter.java` | 同上（云端版本，保护全部路径） |
| `admin-backend/src/test/java/com/eduplay/auth/AuthFilterTest.java` | 云端版本的 9 个用例 |

### 1.2 修改的文件（backend，20 个）

| 文件 | 改了什么 |
|---|---|
| `auth/AuthService.java` | 删掉“传请求头进来”的 3 个方法，只保留按 token 查用户 |
| `auth/AuthController.java` | `profile`、`me` 去掉请求头参数；`logout` 保留（理由见 §4） |
| `admin/AdminAuthController.java` | `me` 改为从上下文取管理员 |
| `admin/AdminCodeController.java` + `AdminCodeService.java` | 去掉请求头参数，`requireAdmin` 改为读上下文 |
| `admin/AdminGameController.java` + `AdminGameService.java` | 同上 |
| `admin/AdminStatsController.java` + `AdminStatsService.java` | 同上，并移除不再使用的 `AuthService` 依赖 |
| `admin/AdminTeacherController.java` + `AdminTeacherService.java` | 同上 |
| `student/StudentController.java` + `StudentService.java` | 10 个端点去掉请求头参数，内部改用 `requireTeacher()` |
| `student/ClassManagementController.java` + `ClassManagementService.java` | 3 个端点同上 |
| `game/GameScoreController.java` + `GameScoreService.java` | 成绩提交同上 |
| `game/GameStoreController.java` + `GameStoreService.java` | 9 个端点同上 |
| `settings/SettingsController.java` | 3 个端点同上，并移除不再使用的 `AuthService` 依赖 |

修改的总量：**41 处 `@RequestHeader("Authorization")` 参数被删除，18 处 `requireXxx` 调用改为读上下文，
9 个类彻底不再依赖 `AuthService`。**

### 1.3 修改的文件（admin-backend，上一轮已完成）

`auth/AuthService`、`auth/AuthController`、`admin/AdminAuthController`、`admin/AdminCodeController`、
`admin/AdminCodeService`、`admin/AdminGameController`、`admin/AdminGameService`、`admin/AdminStatsController`、
`admin/AdminStatsService`、`admin/AdminTagController`、`admin/AdminTagService`、`admin/AdminTeacherController`、
`admin/AdminTeacherService`、`game/CloudGameStoreController`、`game/CloudGameStoreService`。

---

## 2. 核心代码一：AuthContext

`backend/src/main/java/com/eduplay/auth/AuthContext.java`

```java
package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;

public final class AuthContext {

    private static final ThreadLocal<AppUser> CURRENT_USER = new ThreadLocal<>();

    private AuthContext() {
    }

    static void set(AppUser user) {
        CURRENT_USER.set(user);
    }

    static void clear() {
        CURRENT_USER.remove();
    }

    public static AppUser requireUser() {
        AppUser user = CURRENT_USER.get();
        if (user == null) {
            throw new BusinessException("UNAUTHORIZED", "请先登录");
        }
        return user;
    }

    public static AppUser requireAdmin() {
        AppUser user = requireUser();
        if (!"SUPER_ADMIN".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "需要管理员权限");
        }
        return user;
    }

    public static AppUser requireTeacher() {
        AppUser user = requireUser();
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以访问教学数据");
        }
        return user;
    }
}
```

### 为什么不直接传参，要用 ThreadLocal

一个 HTTP 请求从进入 Tomcat 到离开，始终在**同一个线程**上执行。所以可以把这个请求的用户
“挂”在线程上，业务层任何位置都能取到，不需要一层层往下传。

`set` / `clear` 是**包级可见**（前面没有 `public`），意味着只有同包的 `AuthFilter` 能写入，
业务代码无法伪造身份。这是一个刻意的限制。

### 为什么 `clear()` 必须写在 `finally` 里

Tomcat 的线程是复用的。如果不清，下一个请求可能读到上一个请求的用户——
相当于**随机给陌生人发了一张别人的身份证**。这个 bug 不会报错，只会偶发越权。

---

## 3. 核心代码二：AuthFilter

`backend/src/main/java/com/eduplay/auth/AuthFilter.java`（关键部分）

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
public class AuthFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";
    private static final String API_PREFIX = "/api/v1/";
    private static final String ADMIN_PREFIX = "/api/v1/admin/";
    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/v1/health",
            "/api/v1/health/**",
            "/api/v1/auth/local/login",
            "/api/v1/auth/local/register",
            "/api/v1/auth/logout",
            "/api/v1/admin/login",
            "/api/v1/admin/logout",
            "/api/v1/students/import/template",
            "/api/v1/store/games/*/cover",
            "/api/v1/plugin/**"
    );

    private final AuthService authService;

    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String path = requestPath(request);

        // 页面、静态资源、/cloud-api 全部不归这里管
        boolean isApiRequest = "/api/v1".equals(path) || path.startsWith(API_PREFIX);
        if (!isApiRequest) {
            return true;
        }

        return PUBLIC_PATHS.stream().anyMatch(pattern -> PATH_MATCHER.match(pattern, path));
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String token = extractToken(request);

        // 只把「认证」这一段包在 try 里
        AppUser user;
        try {
            if (token == null) {
                throw new BusinessException("UNAUTHORIZED", "请先登录");
            }
            user = authService.requireUserByToken(token);
        } catch (BusinessException | NotFoundException ex) {
            log.warn("拒绝未认证请求 {} {}：{}", request.getMethod(), requestPath(request), ex.getMessage());
            writeJson(response, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录");
            return;
        }

        if (isAdminOnly(requestPath(request)) && !"SUPER_ADMIN".equals(user.getRole())) {
            log.warn("拒绝越权请求 {} {}：用户 {} 不是管理员", request.getMethod(), requestPath(request), user.getId());
            writeJson(response, 403, "FORBIDDEN", "需要管理员权限");
            return;
        }

        AuthContext.set(user);
        try {
            filterChain.doFilter(request, response);
        } finally {
            AuthContext.clear();
        }
    }
}
```

### 三个容易写错的地方

**① 静态资源必须放行。** 这个 jar 同时托管老师端页面（`index.html`、`/assets/**`、`/game/xxx`）。
如果过滤器拦截所有路径，浏览器打开首页就会拿到 401，整个前端打不开。所以先判断
“是不是 `/api/v1` 的请求”，不是就直接放行。

**② 只有“认证”这一段包在 try 里。** 如果 `filterChain.doFilter` 也在 try 里，
下游抛出的 `GAME_NOT_FOUND` 会被 catch 成 401。测试用例
`下游业务异常不被误判成401` 专门锁这一点。

**③ 404 也走过滤器。** `OncePerRequestFilter` 在 `DispatcherServlet` 之前执行，
所以不存在的路径、multipart 上传、静态文件都会经过它。这正是“兜底”能成立的原因——
拦截器（Interceptor）只能拦住已经匹配到 Controller 的请求。

---

## 4. 四个设计决定

### 决定一：默认拒绝，白名单显式列举

改造前是“每处都要记得写检查”，漏一处该接口就裸奔；改造后是“没写就默认拒绝”，
漏配的后果从“任何人都能访问”变成“自己也访问不了”——**错得更安全**。

### 决定二：角色按路径前缀收口

`/api/v1/admin` 和 `/api/v1/admin/**` 要求 `SUPER_ADMIN`，否则 403。
这是第一道锁；服务里的 `AuthContext.requireAdmin()` 是不查库的第二道。

### 决定三：登录、登出、健康检查、模板、封面、插件资源开白名单

见 §5 逐条说明。它们的共同点是：**不返回任何教学数据**。

### 决定四：`/cloud-api` 不在本地重复鉴权

本地代理转发到云端 `admin-backend`，而云端本身已经统一鉴权（同一套过滤器的云端版本）。
在这一跳重复校验没有安全收益，只会让“前端某个云端调用没带 token”变成断链风险。

**代理不是安全边界，真正的边界在云端。** 这个取舍写进了 `AuthFilter` 的类注释。

---

## 5. 白名单逐条解释

| 路径 | 为什么必须公开 | 泄露风险 |
|---|---|---|
| `/api/v1/health` | 桌面端启动时用它判断后端是否就绪，此时还没有登录 | 无，只返回状态 |
| `/api/v1/auth/local/login` | 登录本身不能要求已登录 | 无，但应限流防爆破 |
| `/api/v1/auth/local/register` | 首次使用要能注册 | 无 |
| `/api/v1/auth/logout` | token 过期后点退出不该报错 | 无 |
| `/api/v1/admin/login` | 管理员登录入口 | 无 |
| `/api/v1/admin/logout` | 同上 | 无 |
| `/api/v1/students/import/template` | 前端用 `<a href>` 下载，浏览器导航请求带不了请求头 | 无，空白 Excel 模板 |
| `/api/v1/store/games/*/cover` | `<img>` 标签加载封面 | 无，商品图片 |
| `/api/v1/plugin/**` | iframe 加载游戏资源，凭证是 URL 里的插件令牌 | 由 `PluginContentController` 自己校验令牌，非公开 |

---

## 6. 对象级权限审计结果

这是“鉴权做得好不好”的第三层，过滤器管不到。逐个查过 `backend` 的查询语句：

| 操作 | 查询条件 | 结论 |
|---|---|---|
| 学生列表 / 搜索 / 按班筛选 | `findByTeacherId...` | ✅ 带归属 |
| 学生详情、修改、删除 | `findByIdAndTeacherId` | ✅ 带归属 |
| 积分调整、积分明细 | `findByIdAndTeacherId` | ✅ 带归属 |
| 游戏成绩提交 | `findByIdAndTeacherId` | ✅ 带归属 |
| 班级列表、设置班长、删除班级 | `findByTeacherIdAndClassName...` | ✅ 带归属 |
| 游戏安装 / 卸载 / 已安装列表 | `findByUserIdAndGameId` | ✅ 带归属 |
| 云端包下载（admin-backend） | `findByUserIdAndGameId` + 权益状态 | ✅ 带归属 |
| 设置页（云端地址、插件目录） | 单机单教师，全局配置 | — 无归属概念 |
| 管理后台所有接口 | 全局管理员操作 | — 无归属概念 |

**结论：没有发现水平越权（改 ID 看别人数据）的漏洞。** 这套代码在这一层是健康的，
需要修的是入口不统一，而入口已经修完。

---

## 7. 新增接口时的自检清单

写完一个新接口，按这四条过一遍：

1. **路径在 `/api/v1/**` 下吗？** 是的话默认已受保护，什么都不用做。
2. **需要匿名访问吗？** 只有确实带不了 token（`<img>`、`<a>`、iframe）才加白名单，
   并且确认它不返回教学数据。
3. **要多角色限制吗？** `/api/v1/admin/**` 已自动要求管理员；其他角色用
   `AuthContext.requireTeacher()`。
4. **查的是“某一个资源”吗？** 必须用 `findByIdAndTeacherId(id, 当前用户)` 这种联合查询，
   不要先查出来再 `if` 判断，更不要相信请求体里传来的 `userId`。

---

## 8. 验证记录

### 单元测试（backend）

```
Tests run: 24, Failures: 0, Errors: 0, Skipped: 0
```

其中 `AuthFilterTest` 13 个用例覆盖：未登录 401、无效令牌 401、教师越权 403、管理员放行、
白名单放行、静态资源放行、业务异常不误判、上下文清理。

### 真实实例（端口 7072，内存库，不影响 7070）

| 场景 | 结果 |
|---|---|
| `GET /` 无令牌 | 200（首页正常打开） |
| `GET /api/v1/health` 无令牌 | 200 |
| `GET /api/v1/students` 无令牌 | **401** + `UNAUTHORIZED` |
| `GET /api/v1/students/import/template` 无令牌 | 200 |
| `GET /api/v1/plugin/...` 无令牌 | 400（已放行，进入业务校验） |
| 注册教师后 `GET /api/v1/students` | 200 |
| 教师 token 访问 `/api/v1/admin/games` | **403** + `FORBIDDEN` |
| 无效 token 调用 `/api/v1/auth/logout` | 200 |
| `GET /api/v1/store/games` 带教师 token | 200 |

### 原有集成测试

`GameScoreIntegrationTests`、`GameStoreIntegrationTests` 走真实 HTTP 且未改动一行，
仍全部通过——说明这次改造没有破坏既有业务流程。

---

## 9. 还没做的两件事

1. **登录限流**：目前登录接口可以无限次尝试。建议按“同账号 + 同 IP”失败 5 次锁定 5 分钟。
2. **可观测性**：没有 traceId、没有 Actuator 指标。这是原计划三件事里的第 2 项。
