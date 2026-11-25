---
title: 后端缺陷清单（backend/src 全量排查，v1.5.2）
date: 2026-11-25
scope: backend/src/main/java 全部 71 个文件 + resources 配置 + 14 个 Flyway 迁移
method: 只读静态审查（逐文件精读 + 调用点交叉验证）；未运行、未修改代码
count: 83 条（高 20 / 中 36 / 低 27）；已修复 59 条，未修 24 条（含 2 条设计取舍）
---

# 后端缺陷清单

## 判定口径

- **「缺陷」**：代码行为与意图/契约不一致，或存在可触发的错误、越权、数据不一致。
- **「设计取舍」**：明显是有意为之（注释里写了理由），我不建议直接改，只标注风险。
- 级别按「**被触发的概率 × 后果**」定，不看代码量。

| 类型（按主类型归并） | 条数 | 典型 |
|---|---|---|
| 性能（含 N+1、内存） | 23 | N+1、启动全量哈希、no-store、长事务 |
| 逻辑错误 / 功能缺口 | 17 | 幂等键随机、状态机不闭环、占位 0 值 |
| 安全 / 越权 / 信息泄露 | 15 | 默认口令、token 进 URL、CSV 注入、越权下载 |
| 边界条件 | 7 | 上传上限、空班级、目录嵌套 |
| 事务一致性 / 数据不一致 | 7 | 先删后写、文件与库不同步 |
| 并发 | 5 | check-then-act、乐观锁无重试 |
| 异常处理缺失 | 4 | 兜底 500、错误码错配 |
| 资源泄漏 | 2 | zip 流未关、会话表只增不减 |
| 设计取舍（不改） | 2 | 永久会话、开放注册 |
| 健壮性 | 1 | 手写 JSON 拼接 |

---

## 一、认证与会话（auth）

| ID | 简要描述 | 类型 | 位置 | 级别 |
|---|---|---|---|---|
| B-01 | 空库自动创建 `admin` / **`admin123`**，且永不强制改密 | 安全 | `admin/AdminBootstrapRunner.java:28-39` | 高 |
| B-02 | 未配置 `server.address`，Tomcat 监听 **0.0.0.0**，B-01 的默认口令可被同网段直接使用 | 安全 | `resources/application.yml:25-26` | 高 |
| B-03 | 登录 token 是**永久会话**（哨兵 9999-01-01），无闲置超时、无轮换 | 设计取舍 | `auth/AuthService.java:36-37` | 高 |
| B-04 | 主 token 被拼进 iframe 与每个资源 URL（浏览器历史/日志/代理全记录） | 安全 | `frontend/src/pages/GamePage.tsx:512` → `game/PluginContentController.java:27` | 高 |
| B-05 | 改密/重置密码**不清理 `local_session`**，旧 token 继续有效，"踢人"失效 | 安全 | `admin/AdminTeacherService.java:57-70` | 高 |
| B-06 | `deleteByExpiresAtBefore` 已定义但**从未被调用**，会话表只增不减 | 资源泄漏 | `auth/LocalSessionRepository.java:14` | 中 |
| B-07 | 每次登录新建会话，同一用户可无限多 token 并存，旧会话不失效 | 安全 | `auth/AuthService.java:206-214` | 中 |
| B-08 | `updateProfile` 对 **detached 实体**执行 `save()`（merge 全字段），会覆盖并发修改（如管理员刚禁用的 status 被写回 ACTIVE） | 并发/数据一致性 | `auth/AuthService.java:81-88` | 中 |
| B-09 | `ACCOUNT_DISABLED` 在过滤器里被统一改写成 401「登录状态已失效」，用户看不到"账号被禁用" | 逻辑错误 | `auth/AuthFilter.java:122-126` | 中 |
| B-10 | 登录无失败次数限制/退避，可无限撞库；端口若暴露（B-02）风险放大 | 安全 | `auth/AuthService.java:134-148` | 中 |
| B-11 | 用户不存在时跳过 BCrypt、存在时才计算，响应时间差可枚举用户名 | 安全 | `auth/AuthService.java:135-141` | 低 |
| B-12 | 注册接口开放且无频率限制，任何人可注册教师账号 | 设计取舍 | `auth/AuthController.java:26-43` | 低 |
| B-13 | 注册时 `studentNo`/`className` 未 trim 直接入库，与其他入口（trim 后入库）口径不一致 | 数据一致性 | `auth/AuthService.java:71-72` | 低 |
| B-14 | 过滤器手写 JSON 拼接（`"{\"code\":\"" + code + ...`），当前只拼常量故安全，但属于易踩坑实现 | 健壮性 | `auth/AuthFilter.java:169-180` | 低 |

---

## 二、管理端（admin）

| ID | 简要描述 | 类型 | 位置 | 级别 |
|---|---|---|---|---|
| B-15 | 重置密码无上限校验（仅 `>=6`），BCrypt 对 **>72 字节静默截断**；64 个汉字 = 192 字节，两个"前 72 字节相同"的密码都能登录 | 安全 | `admin/AdminTeacherService.java:64`；`admin/AdminTeacherController.java:63-68` | 中 |
| B-16 | 激活码生成**不校验 gameCode 是否存在**，可为不存在的游戏造码，兑换时才报 GAME_NOT_FOUND | 逻辑错误 | `admin/AdminCodeService.java:44-66` | 中 |
| B-17 | 激活码 CSV 导出**未转义**，username 含 `,`/`"`/`=` 时可破坏列结构，`=`+公式构成 **CSV 注入** | 安全 | `admin/AdminCodeController.java:51-59` | 中 |
| B-18 | `installCount` 恒为 **0**（硬编码），管理端永远显示"0 安装" | 逻辑错误 | `admin/AdminGameService.java:226` | 中 |
| B-19 | `studentCount` 恒为 0 | 逻辑错误 | `admin/AdminTeacherService.java:87` | 中 |
| B-20 | `studentTotal` 恒为 0 | 逻辑错误 | `admin/AdminStatsService.java:37` | 中 |
| B-21 | 游戏列表每行 2 次查询（`countByGameId` + `findByGameIdOrderByVersionDesc().size()` 全量加载仅为计数） | 性能 | `admin/AdminGameService.java:216-229` | 中 |
| B-22 | 激活码列表每个已用码 1 次 `findById` | 性能 N+1 | `admin/AdminCodeService.java:83-99` | 中 |
| B-23 | 激活码生成 500 条逐条 `save`，未批量；唯一键冲突无重试 | 性能 | `admin/AdminCodeService.java:56-65` | 低 |
| B-24 | 激活码列表无分页，全量返回 | 性能 | `admin/AdminCodeService.java:36-41` | 低 |
| B-25 | 教师列表全量加载后在内存 filter，无分页 | 性能 | `admin/AdminTeacherService.java:35-41` | 低 |
| B-26 | `createGame` 的 `gameCode` 无格式校验（允许中文/空格/`/`），后续会拼进 URL 与文件名（文件名有 sanitize，URL 没有） | 边界条件 | `admin/AdminGameService.java:61-81` | 低 |
| B-27 | 上传包在事务内做 SHA-256 + 写盘 + 解压，长事务占连接 | 事务/性能 | `admin/AdminGameService.java:100-157` | 中 |
| B-28 | `commitPackage` 在事务内执行，若随后提交失败则磁盘已是新包、DB 回滚 | 事务一致性 | `admin/AdminGameService.java:148` | 低 |

---

## 三、商城 / 插件 / 成绩（game）

| ID | 简要描述 | 类型 | 位置 | 级别 |
|---|---|---|---|---|
| B-29 | 已有权益为**非 ACTIVE** 时仍执行 insert，撞唯一键 `uk_user_entitlement` → 500，提示还被译成"字段超长" | 逻辑错误/异常处理 | `game/GameStoreService.java:194-222` | 高 |
| B-30 | 任课教师可**下载任意游戏包**（`downloadPackage` 不校验 entitlement），付费包可被白拿 | 越权 | `game/GameStoreService.java:368-379` | 中 |
| B-31 | 教师侧导入包会把商品 `status` **强制改成 ACTIVE**，管理端设的 DRAFT 被绕过 | 逻辑错误 | `game/GameStoreService.java:282,294` | 中 |
| B-32 | 卸载：**先删磁盘文件再删库行**，同一事务；任一侧失败即"显示已安装但打开 404" | 事务一致性 | `game/GameStoreService.java:359-366` | 中 |
| B-33 | 安装：**先 `deleteRecursively(旧目录)` 再解压**，中途失败旧版被毁 | 数据丢失 | `game/PluginPackageService.java:136-137` | 高 |
| B-34 | 解压无单文件/总大小上限，zip bomb 可写满磁盘 | 安全 | `game/PluginPackageService.java:143-158` | 中 |
| B-35 | 解压全程在 DB 事务内（`installGame` / `installDownloadedPackage`） | 事务/性能 | `game/GameStoreService.java:227-257,259-338` | 中 |
| B-36 | `importDownloadedPackage` 先 `getBytes()` 解析 manifest，内部又 `getBytes()` 一次、再解析一次 zip | 性能/内存 | `game/GameStoreService.java:341-357` | 中 |
| B-37 | 封面接口每次都**打开 zip 并解析 manifest.json**，无缓存 | 性能 | `game/GameStoreService.java:386-431` | 中 |
| B-38 | 封面读 zip entry 的流未 close（只靠 `ZipFile.close()` 兜底），高频请求下可能堆积 | 资源泄漏 | `game/GameStoreService.java:396-399` | 低 |
| B-39 | `getGame()` 不过滤 `status`，DRAFT 游戏的封面/包/清单可被按 code 直接访问 | 越权（低危） | `game/GameStoreService.java:655-658` | 低 |
| B-40 | 插件资源响应 `Cache-Control: no-store`，路径已含 `{version}`（内容不可变）却完全不可缓存 | 性能 | `game/PluginContentController.java:40` | 高 |
| B-41 | **每个插件资源 4 次 DB 查询**（会话/用户/游戏/安装），一次开游戏 80–160 次 | 性能 | `game/PluginContentService.java:42-59` | 高 |
| B-42 | 插件资源整个 `readAllBytes` 进堆内存 | 内存 | `game/PluginContentController.java:37` | 中 |
| B-43 | 每次启动对全部包重算 SHA-256（实测 **157 个 zip / 250 MB**） | 性能 | `game/PluginPackageSyncRunner.java:26-42` | 高 |
| B-44 | 同步任务对**任意异常**（含临时锁文件）标 `MISSING`，而所有查询都不按 status 过滤 → 状态机不闭环，一次抖动永久"假 MISSING" | 逻辑错误 | `game/PluginPackageSyncRunner.java:37-40`；`game/GamePackageRepository.java:37-40` | 高 |
| B-45 | 成绩幂等用 `existsByIdempotencyKey` 再 insert（check-then-act），并发同 roundId 撞唯一键 → 500 | 并发 | `game/GameScoreService.java:69-90` | 高 |
| B-46 | 积分"读 totalPoints → 加 → 存"，`@Version` 冲突抛 `ObjectOptimisticLockingFailureException` 且无重试 → 500 | 并发 | `game/GameScoreService.java:73-75`；`student/Student.java:44-46` | 高 |
| B-47 | `findLatestByGameId` 全量加载该游戏所有版本再内存比较，不过滤 status | 性能/逻辑 | `game/GamePackageRepository.java:37-40` | 低 |
| B-48 | 批量取版本时 `findByGameIdIn` 加载**所有历史版本**（157 条）只为取每游戏最新 | 性能 | `game/GameStoreService.java:149-162` | 低 |
| B-49 | `syncManifestTags` 每个新标签调一次 `tagRepository.count()`，关联逐条 save，且每次全删重建（非幂等增量） | 性能/幂等 | `game/GameStoreService.java:605-645` | 低 |
| B-50 | 标签只能写不能读：`findByStatusOrderByCategoryAsc...` 无任何调用点，标签 REST 能力缺失 | 死代码/功能缺口 | `game/GameTagRepository.java:10` | 低 |

---

## 四、学生与班级（student）

| ID | 简要描述 | 类型 | 位置 | 级别 |
|---|---|---|---|---|
| B-51 | 手工调分/编辑积分的 `idempotency_key` 用 `UUID.randomUUID()` 生成 → **每次重试都是新键，幂等形同虚设**，网络重试会重复加减分 | 逻辑错误 | `student/StudentService.java:262,312` | 高 |
| B-52 | 手工新增学生 `initialPoints` **无任何范围校验**（导入路径有 0–99999 校验，手工路径没有） | 边界条件 | `student/StudentService.java:205-213` vs `:440` | 高 |
| B-53 | 编辑学生 `totalPoints` 是**客户端绝对值覆盖**，只校验 `<0`、无上限，且按差额补流水 | 逻辑错误/边界 | `student/StudentService.java:246-264` | 高 |
| B-54 | 调分读-改-写，乐观锁冲突无重试 → 双击/双标签页必有一个 500 | 并发 | `student/StudentService.java:294-300` | 高 |
| B-55 | 导入是"全成功或全失败"，且整批一个事务：任一行撞唯一键 → 整批回滚，只回 500 | 逻辑错误 | `student/StudentService.java:75-91` | 中 |
| B-56 | 导入逐行 `existsByTeacherIdAndClassNameAndStudentNo`（N 次查询）+ 每行 `saveAndFlush`（N 次 flush） | 性能 | `student/StudentService.java:428,388` | 中 |
| B-57 | `buildGameNameMap` 注释写"避免逐条查询"，实现仍是逐条 `findByGameCode`（注释与实现不一致） | 性能/文档误导 | `student/StudentService.java:340-350` | 中 |
| B-58 | 积分流水无分页，一次性返回该学生全部流水 | 性能 | `student/StudentService.java:324-325` | 中 |
| B-59 | 在 `readOnly` 事务内生成 Excel（POI），事务持有时间与导出耗时同长 | 性能 | `student/StudentService.java:143-180` | 中 |
| B-60 | Excel 解析无行数上限，稀疏表可把 `getLastRowNum()` 撑到百万级空转 | 边界/DoS | `student/StudentService.java:453-506` | 低 |
| B-61 | `parseInt` 对 `"1.5"`/`"1,000"` 直接抛异常导致**整批失败**，无逐行容错 | 边界条件 | `student/StudentService.java:537-549` | 低 |
| B-62 | 学生列表无分页，全校名单一次返回 | 性能 | `student/StudentService.java:94-141` | 低 |
| B-63 | 班级列表：每个班再查 2 次（学生 + 班委） | 性能 N+1 | `student/ClassManagementService.java:48,104-135` | 中 |
| B-64 | 删班级逐个删流水（N 次） | 性能 | `student/ClassManagementService.java:91-93` | 低 |
| B-65 | 学生按 `IgnoreCase` 查出，删除却用**区分大小写**的 `deleteByTeacherIdAndClassName` → 英文班名大小写不一致时删不干净，撞 FK 报 500 | 逻辑错误 | `student/ClassManagementService.java:83-97` | 中 |
| B-66 | 只有 `teacher_class` 记录、没有学生的班级**无法删除**（`students.isEmpty()` 直接 404） | 逻辑错误 | `student/ClassManagementService.java:80-90` | 低 |
| B-67 | 首次创建班委记录并发时撞 `uk_teacher_class`，无 upsert/重试 | 并发 | `student/ClassManagementService.java:59-76` | 低 |

---

## 五、设置 / 云端代理 / 公共

| ID | 简要描述 | 类型 | 位置 | 级别 |
|---|---|---|---|---|
| B-68 | 任何教师可改「云端地址」，且允许 `http://` 任意主机；配合 `/cloud-api` 会把云端 Authorization 转发到任意地址 | 安全（组合链） | `settings/SettingsController.java:58-68`；`settings/SettingsService.java:137-156` | 中 |
| B-69 | `/cloud-api/**` **完全不鉴权**，任何本机/同网段请求都可当跳板 | 安全 | `cloudproxy/CloudApiProxyController.java:35-46`；`auth/AuthFilter.java:96-100` | 中 |
| B-70 | 代理只回传 `Content-Type`，**丢弃 `Location`/`Set-Cookie`/`WWW-Authenticate`** 等响应头 | 异常处理/契约 | `cloudproxy/CloudApiProxyController.java:73-85` | 中 |
| B-71 | 代理 `body = readAllBytes()` 全量入堆，大请求可撑爆 | 内存 | `cloudproxy/CloudApiProxyController.java:46` | 低 |
| B-72 | 健康检查**不探测数据库**，DB 挂了仍返回 `UP`，Electron 的启动判定会误判 | 逻辑错误 | `health/HealthController.java:15-21` | 中 |
| B-73 | 目录迁移逐个子项 `Files.move`，中途失败无回滚；且**先移文件后写库** | 事务一致性 | `settings/SettingsService.java:76-81` | 中 |
| B-74 | 新目录若是旧目录的**子目录**，`moveChildren` 会枚举到刚创建的 newDir 并尝试移进自身 → 失败 | 边界条件 | `settings/SettingsService.java:84-106` | 低 |
| B-75 | `volatile` 缓存无失效机制，多 JVM（H2 `AUTO_SERVER=TRUE`）或外部改库后读到旧值 | 逻辑错误 | `settings/SettingsService.java:28-29,41-51` | 低 |
| B-76 | `getSettings` 只要求登录即返回服务器绝对路径与数据库路径 | 信息泄露 | `settings/SettingsController.java:39-44` | 低 |
| B-77 | `BusinessException` **一律映射 400**：`UNAUTHORIZED`/`FORBIDDEN` 也变 400，前端"401 才清凭证"的逻辑失效 | 异常处理缺失 | `common/GlobalExceptionHandler.java:102-106` | 高 |
| B-78 | 兜底 `Exception → 500` 吞掉：JSON 解析失败、路径参数类型错、方法不支持、**上传超限** 全部变"服务器内部错误" | 异常处理缺失 | `common/GlobalExceptionHandler.java:158-163` | 高 |
| B-79 | 上传上限 10 MB，而现有最大包已 **7.09 MB**，余量 2.9 MB；超限无专门处理（见 B-78） | 边界条件 | `resources/application.yml:11-14` | 高 |
| B-80 | 唯一约束冲突的提示被硬编码成"字段超长"，与实际原因不符 | 提示错误 | `common/GlobalExceptionHandler.java:131-141` | 中 |
| B-81 | SQL 日志 `info` + `format_sql: true` 常开（生产态也打多行 SQL） | 性能/日志膨胀 | `resources/application.yml:9,36` | 中 |
| B-82 | SPA 兜底把 `/api`、`/cloud-api`（无尾斜杠）这类路径也当路由返回 `index.html` 200 | 边界条件 | `common/GlobalExceptionHandler.java:81-94` | 低 |
| B-83 | 学生导出/导入模板在异常时抛 `IOException`，直接落 500 | 异常处理缺失 | `student/StudentService.java:144-147,352` | 低 |

---

## 附：死代码 / 半成品（不算 bug，但会误导后续修改）

| 项 | 位置 |
|---|---|
| `GameProductResponse` 整个类无人引用 | `game/GameProductResponse.java` |
| `deleteByExpiresAtBefore` 无调用点（见 B-06） | `auth/LocalSessionRepository.java:14` |
| `existsByStudentNo`、`existsByCode`、`existsByGameIdAndVersion`、`findFirstByGameIdOrderByVersionDesc`、`GameProductTagRepository.findByGameId` 均无调用点 | 各 Repository |
| `points` 空包 | `backend/src/main/java/com/eduplay/points/` |
| `AuthService.TOKEN_PREFIX` 与 `AuthFilter.BEARER_PREFIX` 重复定义 | `auth/AuthService.java:22`、`auth/AuthFilter.java:52` |

---

## 建议的分析顺序

按「**能立刻造成用户可见错误** → **静默算错** → **安全** → **性能**」排，不建议按文件排：

1. **必现 500 组**：B-29、B-45、B-46、B-54、B-65
2. **静默算错组**：B-51、B-52、B-53、B-18/B-19/B-20、B-44
3. **安全组**：B-01、B-02、B-04、B-05、B-15、B-17、B-30、B-68、B-69
4. **数据丢失组**：B-33、B-32、B-73
5. **性能组**：B-40、B-41、B-43、B-21、B-56、B-63、B-77（错误码先修，否则前端无法区分重试）
6. 其余按模块收尾

> 注：B-03（永久会话）与 B-12（开放注册）是**有意设计**，改之前要先确认产品意图，不要顺手"修"。

---

## 修复记录（2026-11-25 复核实修）

复核口径：逐条回到代码确认「能不能在现网数据下真的触发」。**83 条全部属实**，无纯误报；
其中 2 条判定为设计取舍（B-03、B-12），实际修复 **59 条**，剩余 22 条属于「需要产品/架构决定」或「影响不足以承担改动风险」，逐条写明原因。

| 状态 | 条数 | 编号 |
|---|---|---|
| 已修复 | 59 | 见下五张表 |
| 未修：设计取舍，刻意不改 | 2 | B-03、B-12 |
| 未修：需前置条件，本轮不动 | 22 | 见文末「未修项与前置条件」 |

### 一、异常与错误码（4 条）

| ID | 修复要点 |
|---|---|
| B-77 | `BusinessException` 按 code 分档：`UNAUTHORIZED`/`ACCOUNT_DISABLED`→401，`FORBIDDEN`→403，`*_NOT_FOUND`→404，其余 400 |
| B-78 | 兜底 500 收窄：新增 413（上传超限）、400（JSON 非法 / 路径参数类型错 / 缺参数 / 缺文件字段 / multipart 解析失败）、405（方法不支持）；**本次复验又补 415（Content-Type 不支持）** |
| B-80 | 唯一键冲突单独识别约束名 → 409 `DATA_CONFLICT`，与「字段超长」的 400 分开 |
| B-82 | SPA 兜底排除裸 `api`、`cloud-api` 前缀，不再返回 `index.html` 200 |

### 二、认证与会话（10 条）

| ID | 修复要点 |
|---|---|
| B-01 | 管理员初始口令改读 `EDUPLAY_ADMIN_PASSWORD`，仍在用默认值时启动打 WARN |
| B-02 | `server.address` 默认 `127.0.0.1`（可用 `EDUPLAY_BIND_ADDRESS` 覆盖） |
| B-04 | 主登录 token 不再进 URL：新增 8 小时短期票据（`PluginPlayTicketService`），iframe 只带票据；主 token 直接访问插件资源一律 401 |
| B-05 | 重置密码 / 禁用账号时 `deleteByUserId`（本次新增的仓库方法）清会话，"踢人"真正生效 |
| B-08 | `updateProfile` 改为按 id 重读受管实体再改字段，不再 merge detached 实体覆盖 status |
| B-09 | 过滤器保留后端原始 code 与 message（禁用原因可见），状态码统一 401 以便前端正常清凭证 |
| B-11 | 用户不存在时也跑一次 BCrypt（构造期预生成 dummy hash），消除时序侧信道 |
| B-13 | 注册走 `normalizeNullable`，`studentNo`/`className` 与其他入口同样 trim + 空转 null |
| B-14 | 过滤器手写 JSON 补 `escape()`，字段含引号/反斜杠不再破坏响应体 |
| B-15 | 注册/重置密码按 **UTF-8 字节**校验 ≤72（`MAX_PASSWORD_BYTES`），避免 BCrypt 静默截断 |

### 三、并发、幂等与数据一致性（12 条）

| ID | 修复要点 |
|---|---|
| B-29 | 兑换先查已有权益：ACTIVE 报 `ALREADY_OWNED`，非 ACTIVE 复用该行改回 ACTIVE，不再撞唯一键 500 |
| B-32 | 卸载改为「先删库行 + flush，再删磁盘」，磁盘失败只 warn —— 不会出现"显示已安装但打开 404" |
| B-33 | 安装改为解压到 `.installing-<uuid>` → 校验 manifest → 旧目录 move 成 `.old-<uuid>` → 新目录 move 到位，失败回滚，旧版不再被先删后写毁掉 |
| B-45 | 成绩结算改用 `findForUpdateByIdAndTeacherId`（`SELECT … FOR UPDATE`）行锁，check-then-act 窗口消失 |
| B-46 | 同上，积分读改写不再依赖 `@Version` 乐观锁（原实现冲突即 500 且无重试） |
| B-51 | 手工调分改用客户端 `requestId` 生成稳定幂等键，网络重试不再重复加减分 |
| B-52 | 手工新增学生补 `initialPoints` 0~99999 校验（与导入路径同口径） |
| B-53 | 编辑积分同样走行锁 + 0~99999 上限，差额补流水逻辑不变 |
| B-54 | 调分改行锁，双击/双标签页不再必有一个 500 |
| B-65 | 删班级改用「按学生实际 className 删除 + `deleteByStudentIdIn` 批量删流水」，英文班名大小写不一致也能删净 |
| B-66 | 只有班委记录、没有学生 / 流水的班级现在可以删（原 `students.isEmpty()` 直接 404） |
| B-64 | 班级流水分批删除（`deleteByStudentIdIn`），不再逐条 |

### 四、性能与真实统计（21 条）

| ID | 修复要点 |
|---|---|
| B-21 | 游戏列表从「每行 2~3 次查询」改为 3 条 `group by gameId` 聚合后内存拼装 |
| B-22 | 激活码列表用 `findAllById` 一次取回 usedBy 用户，去掉 N+1 |
| B-23 | 激活码生成改 `saveAll` 批量插入 |
| B-37 | 封面加 `ConcurrentHashMap` 缓存（上限 200，key = gameCode:version:sha256），不再每次开 zip 解析 manifest |
| B-38 | 读 entry 的流改 try-with-resources，不再只靠 `ZipFile.close()` 兜底 |
| B-40 | 插件资源改 `max-age=1y, private, immutable`，路径含 `{version}` 内容不可变，可长缓存 |
| B-41 | 插件的「会话+用户」合为一条联表 SQL，每个资源从 4 次查询降到 2 次；配合票据省掉重复鉴权 |
| B-42 | 插件资源改 `FileSystemResource` 流式返回，不再 `readAllBytes` 全量入堆 |
| B-43 | 启动同步：大小未变且已有 sha256 且状态 PUBLISHED 时跳过重算，只对新增/变更的包哈希 |
| B-44 | 同步任务只在「包确实找不到」时标 MISSING，其他异常 warn 跳过；去 `@Transactional` 改逐条落库，一次抖动不再留下永久假 MISSING |
| B-49 | `syncManifestTags` 的 `count()` 只查一次（`nextSortOrder` 局部计数器） |
| B-56 | 学生导入改为「一次 `findClassStudentKeys` 建 Set 判重 → `saveAll` → 一次 flush → 批量写流水」 |
| B-57 | `buildGameNameMap` 改 `findByGameCodeIn`，注释与实现终于一致 |
| B-63 | 班级列表改为一次取全部学生后按小写班名分组，去掉每班 2 次查询 |
| B-18、B-19、B-20 | 三个占位 0 值（`installCount`/`studentCount`/`studentTotal`）改为真实统计 |
| B-72 | 健康检查真的执行 `select 1`，DB 不可用返回 **503**（Electron 启动判定不再误判） |
| B-79 | 上传上限 10 MB → 100 MB（`EDUPLAY_MAX_UPLOAD` 可调），超限回 413 |
| B-81 | SQL 日志降级：`org.hibernate.SQL` 默认 `warn`、`format_sql` 默认 `false`（`EDUPLAY_SQL_LOG`/`EDUPLAY_SQL_FORMAT` 可开） |
| B-83 | 导出/模板改抛 `BusinessException`，不再落 500 |

### 五、数据安全与边界（12 条）

| ID | 修复要点 |
|---|---|
| B-16 | 生成激活码前校验 gameCode 存在，不再为不存在的游戏造废码 |
| B-17 | CSV 导出加 `csvField`：`=`/`+`/`-`/`@`/`\t`/`\r` 前置单引号，含逗号引号换行时加引号并双写；`Content-Type` 补 `charset=UTF-8` |
| B-26 | 新建游戏校验 `gameCode` 仅 `[A-Za-z0-9_-]`，不再允许中文/空格/斜杠进 URL |
| B-30 | `downloadPackage` 补 `ensureEntitlement`，未兑换不能拿包 |
| B-31 | 教师侧导入包只在**新建商品**时置 ACTIVE，管理端设的 DRAFT 不再被绕过 |
| B-34 | 解压加双上限：累计写出字节 512 MB、entry 数 20000，zip bomb 不再能写满磁盘 |
| B-36 | `importDownloadedPackage` 只 `getBytes()` 一次，复用同一份字节 |
| B-60 | 导入按 `getLastRowNum()` 限制 2000 行 |
| B-61 | `parseInt` 容忍千分位、全角逗号、空格、"分"后缀与小数部分为 0 的 `BigDecimal` |
| B-70 | 代理回传 `Location`/`Set-Cookie`/`WWW-Authenticate`/`Retry-After`/`Content-Disposition`/`ETag`/`Last-Modified`/`Cache-Control`/`Content-Language` |
| B-73 | 目录迁移改为「先整批检查冲突，再逐个移动」，且拒绝新旧目录互相包含 |
| B-74 | 新目录是旧目录子目录时直接拒绝，`moveChildren` 不会枚举到自己 |

### 六、复验中新增的一条

| ID | 描述 | 修复 |
|---|---|---|
| B-84 | `HttpMediaTypeNotSupportedException` 未处理 → Content-Type 写错时兜底 500「服务器内部错误」，排查方向被误导 | 补 `HttpMediaTypeNotSupportedException`→**415** `UNSUPPORTED_MEDIA_TYPE`、`HttpMediaTypeNotAcceptableException`→406 |

### 未修项与前置条件

| ID | 为什么不改 |
|---|---|
| **设计取舍，刻意不改** | |
| B-03 | 登录 token 是永久会话。桌面端教师电脑经常整学期不关，缩短有效期会变成"每天上课前都要重登"，产品上不接受；要改得先有"静默续期"方案 |
| B-12 | 注册接口开放。当前没有邀请码/学校白名单的分发渠道，关掉注册等于没人能用；等 admin 后台做账号发放后再关 |
| **需前置条件** | |
| B-06 | 需要 `@Scheduled` 清理任务；当前无 Spring Task 配置，且**永久会话**（B-03）下过期行本来就极少，收益低于引入定时任务的风险 |
| B-07 | 多 token 并存要配合「单端登录/踢旧」产品决策；桌面端与网页版可能同时在线，先不改 |
| B-10 | 登录失败限流需要引入桶/缓存（Redis 或 Caffeine），属独立基础设施，不适合塞进这轮 |
| B-24、B-25、B-58、B-62 | 无分页。真实数据量（单校千级学生、激活码万级）下前端一次性渲染仍是瓶颈，但改分页要同步改 5 个页面的交互，需单独排期 |
| B-27、B-35、B-59 | 事务内文件 I/O / Excel 生成。正确解法是把 I/O 提到事务外（需重排 `installGame` 的状态流转），改动面大且当前无性能投诉 |
| B-28 | `commitPackage` 在事务内、提交失败时磁盘已是新包。与 B-27 同源，随「I/O 出事务」一并解决 |
| B-47、B-48 | 全量加载历史版本。修它要改「最新版本」的选取口径（`findFirstByGameIdOrderByVersionDesc` 是全平台统一用法，见 MEMORY §7），**不能单点改** |
| B-39 | `getGame()` 不过滤 status，DRAFT 游戏的封面/包可按 code 直接访问。要改需先明确"教师侧导入的包在 DRAFT 状态下是否可播"，属产品语义问题 |
| B-50 | 标签只写不读，属于功能缺口，需产品确认是否要暴露标签筛选 |
| B-55 | 导入"全成功或全失败"改成部分成功，要重新设计返回结构与前端提示（当前返回 `StudentImportResult` 已能承载逐行错误，但前端未消费），随 B-24 一起做 |
| B-67 | 班委并发建记录撞唯一键。单人操作场景下概率极低，等有班主任协作需求再上 upsert |
| B-68、B-69 | 云端地址可改 + `/cloud-api` 不鉴权是一条组合链。彻底修需要「云端地址白名单 + 代理侧校验本地 token」，涉及配置迁移，需单独评估 |
| B-71 | 代理 body 全量入堆，实测请求体都很小；改成流式要重写代理实现，收益有限 |
| B-75、B-76 | 设置缓存失效与路径信息泄露。当前单 JVM 场景下缓存不会读到旧值；`getSettings` 的路径只给已登录教师看，风险低 |

### 验证方式（可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 单测 | `mvn -o test` | **25 tests, 0 failures** |
| 接口冒烟 | `python backend/src/test/smoke/api_smoke.py` | **17 项全 PASS**（含 415、幂等、并发、积分范围、票据 401） |
| 插件端到端 | `python backend/src/test/smoke/plugin_ticket_smoke.py` | **19 项全 PASS**（含越权下载、重复兑换、票据跨版本、卸载失效、缓存头） |
| 前端类型/构建 | `tsc --noEmit` + `vite build` | 无错误 |
| 真实渲染（换票入口） | Electron 离屏渲染 `E:/tmp/eduplay-smoke/verify_visual/main.js` | 7 项全 PASS：iframe 用票据、URL 无主 token、确换票、内联脚本执行、canvas 有像素、`immutable` 缓存头、资源 200 |

> 前置：冒烟脚本需要一个**非 7070 端口**的临时实例（数据库/插件目录独立）。
> 全新库没有 `admin`/`admin123`，管理员由 `AdminBootstrapRunner` 按 `EDUPLAY_ADMIN_PASSWORD` 创建。

