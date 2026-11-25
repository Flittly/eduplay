---
title: 后端性能与缺陷审查（v1.5.2）
date: 2026-11-25
scope: backend/（Spring Boot 4.1.1 + JDK 21 + H2 file）
method: 只读审查，逐文件精读；未修改任何代码
conclusion: 启动慢的主因是「每次启动全量 SHA-256 250MB 插件包」；游戏页慢的主因是「插件资源 no-store + 每文件 4 次查库」；最该先修的安全项是 admin/admin123 默认口令与 0.0.0.0 监听。
---

# 后端性能与缺陷审查

## 0. 结论先行

**「下次打开慢」只有三个真凶，其余都是噪声：**

| # | 真凶 | 量级 |
|---|---|---|
| 1 | 每次启动对**全部 157 个插件包（250 MB）**重算 SHA-256 | 机械盘/U 盘 8–20 s，SSD 1–2 s |
| 2 | 游戏资源 `Cache-Control: no-store`，每次开游戏全量重下 | 每个游戏 4–8 MB × 每次 |
| 3 | 每个插件资源走 **4 次数据库查询**（会话/用户/游戏/安装） | 单次开游戏 80–160 次查询 |

**必须先修的缺陷（按下单顺序）：**
`admin/admin123` + 监听 0.0.0.0 → 登录 token 直接进 URL → 改密码不失效旧会话 → 上传 10 MB 上限（现有最大包已 7.09 MB）→ 积分并发 check-then-act → 导入 N+1。

---

## 1. 性能瓶颈

### PF-01 启动时全量重算包哈希（**最高优先级**）

- 位置：`backend/src/main/java/com/eduplay/game/PluginPackageSyncRunner.java:26-42`（哈希在 `:33`）
- 现象：`run()` 无条件遍历 `packageRepository.findAll()`，对每个包 `computeSha256(path)` 并 `Files.size()`，整段还在一个 `@Transactional` 里。
- 实测数据：`backend/plugins/packages` 现有 **157 个 zip / 250 MB**（`du -sh` = 250M）。
- 影响：每次点开 EduPlay，主线程在读完 250 MB 之前一直占用磁盘；便携版跑在 U 盘（约 25 MB/s）时约 **10 秒**，且与首屏 `index.html` + 345 KB JS 抢同一块盘 → 用户看到的是「logo 转很久」。
- 优化：
  1. 只处理「需要」的包：`if (sha256 != null && sizeBytes != null && sizeBytes == Files.size(path) && mtime <= 库里某时间戳) continue;`
  2. 或改成 `@Async` 后台任务，不阻塞启动；启动只做一次 `exists` 校验。
  3. 哈希结果按 `(packageName, size, lastModified)` 存一份磁盘缓存（`plugins/.hash-cache.json`）。
- 预期：启动磁盘读从 250 MB 降到 < 1 MB，**首屏可省 1–10 s**。

### PF-02 插件资源不可缓存 + 每文件 4 次查库（**直接决定「开游戏」体感**）

- 位置：`backend/src/main/java/com/eduplay/game/PluginContentController.java:40`（`CacheControl.noStore()`）；
  `backend/src/main/java/com/eduplay/game/PluginContentService.java:42-51`（每请求 4 次查询）
- 现象：`serveFile()` 每个资源都执行 `requireUserByToken`（1 次查 `local_session` + 1 次查 `app_user`）、`findByGameCode`、`findByUserIdAndGameId`；控制器再把整个文件 `Files.readAllBytes` 进内存。响应头是 `no-store`，浏览器与 Electron 一律不缓存。
- 影响：一个 three.js 游戏 20–40 个资源 → **80–160 次 H2 查询 + 每次开游戏重新下载 4–8 MB**。这是「第二次打开还是慢」的唯一原因。
- 优化（按收益排序）：
  1. **把 `no-store` 换成 `private, max-age=31536000, immutable`**。资源路径里已含 `{version}`，版本不变内容就不变，天然可长缓存；token 在路径里，用 `private` 保证不进共享缓存。
  2. **进程内缓存鉴权结果**：`Cache<String, AuthSnapshot>`（Caffeine/`ConcurrentHashMap` + TTL 60 s），一次开游戏从 160 次查询降到 4 次。
  3. **别 `readAllBytes`**：返回 `FileSystemResource` 或 `InputStreamResource`，让 Spring 直接 `transferTo`，并带上 `Content-Length` + `Last-Modified`（顺带支持 304）。
- 预期：**二次打开从 4–8 MB 下载 + 160 次查询，降到 0 字节 + 0 次查询**。

### PF-03 封面每次开 zip 解析 manifest

- 位置：`backend/src/main/java/com/eduplay/game/GameStoreService.java:386-431`（`new ZipFile` 在 `:391`）
- 现象：`downloadCover` 每次都打开最新包的 zip、读 `manifest.json`、再取 cover 字节；响应只有 `max-age=300`（`:98`），5 分钟后浏览器重来。商店页 17 个游戏 = 17 次开 zip + 17 次 JSON 解析。
- 优化：按 `(gameId, version)` 缓存 `CoverFile` 到内存（封面通常 < 200 KB，17 个游戏全缓存也才 3 MB），并加 `ETag = sha256(bytes)`；命中直接 304。
- 预期：商店页从「17 次磁盘随机读 + 解析」降到「1 次内存取」。

### PF-04 每个 API 请求 2 次鉴权查询

- 位置：`backend/src/main/java/com/eduplay/auth/AuthFilter.java:121` → `AuthService.java:187-204`
- 现象：`requireUserByToken` 每请求查 `local_session` + `app_user`，无任何缓存。所有页面首屏会并发 3–6 个接口 → 6–12 次鉴权查询。
- 优化：`token → (userId, role, status)` 缓存 30–60 s，登出/禁用/改密时主动失效。注意禁用要能「立刻踢出」，TTL 别超过 60 s，或禁用时清缓存。
- 预期：单页首屏省 6–10 次查询（H2 本地约 3–8 ms）。

### PF-05 五处 N+1（注释写着「已批量」，实现仍是逐条查）

| 位置 | 实际查询数 |
|---|---|
| `student/ClassManagementService.java:48` → `:104-135` | 1 + **2 × 班级数**（学生列表 + 班委） |
| `student/StudentService.java:340-350` `buildGameNameMap` | 1 × 不同 gameCode 数（`findByGameCode` 逐条） |
| `admin/AdminCodeService.java:86` `toResponse` | 1 × 已使用码数（`userRepository.findById` 逐条） |
| `admin/AdminGameService.java:225,227` `toResponse` | 1 + **2 × 游戏数**（`countByGameId` + `findByGameIdOrderByVersionDesc().size()`） |
| `student/StudentService.java:428` 导入校验 | 1 × 行数（`existsBy...` 逐行） |

- 修法统一：一次 `IN` 查出全部，内存分组。`buildGameNameMap` 的注释明确声称「避免逐条查询」，属于**注释与实现不一致**，建议同批修掉。
- `AdminGameService:227` 的 `.size()` 会加载全部包实体，改成 `countByGameId` 即可。

### PF-06 积分流水无分页

- 位置：`student/StudentService.java:324-325`；`student/StudentPointsLedgerRepository.java:10`
- 现象：`findByStudentIdOrderByCreatedAtDesc` 返回该学生**全部**流水。一个班一学期玩几百局，单学生上千条，前端一次渲染全部。
- 优化：`Pageable` 取前 50 条 + 「加载更多」；或首屏只返回最近 200 条。同时加复合索引 `(student_id, created_at desc)`（见 PF-11）。

### PF-07 大文件整块读进内存

- `GameStoreService.java:375` `Files.readAllBytes(包)` — 7 MB 包没问题，但如果以后上 100 MB 包，32 位版 `-Xmx768m` 下会 OOM。
- `PluginContentController.java:37` 同上。
- 修法：`ResponseEntity<Resource>` / `StreamingResponseBody`，零拷贝。

### PF-08 长事务包住文件 I/O

| 位置 | 事务里做了什么 |
|---|---|
| `game/GameStoreService.java:227-257` `installGame` | 解压整个包（`PluginPackageService.install:117-170`）+ 递归删除旧版本 |
| `game/GameStoreService.java:259-338` `installDownloadedPackage` | `getBytes()` + 读 manifest + 写临时文件 + SHA-256 + 解压 |
| `student/StudentService.java:143-180` `createExportWorkbook` | 在 `@Transactional(readOnly=true)` 里跑 POI 生成 xlsx |
| `settings/SettingsService.java:56-82` `changePluginInstallDir` | 在事务里 `Files.move` 整个安装目录 |

- 影响：一条 7 MB 解压压着 H2 连接 + `AUTO_SERVER` 文件锁，期间其它接口排队；导出 Excel 也占着连接池（池大小默认 10）。
- 修法：事务只包 DB 写；文件操作放事务外，用「先写临时文件 → 提交 DB → 再 rename」的顺序（这条项目里已有正确范式，见 `PluginPackageService.stagePackage/commitPackage`，只是调用位置还在事务内）。

### PF-09 SQL 日志在「生产」里全开

- 位置：`backend/src/main/resources/application.yml:9`（`format_sql: true`）、`:36`（`org.hibernate.SQL: info`）
- 现象：每条 SQL 都以多行美化格式打到 stdout；Electron 通过管道捕获 stdout → **同步管道写**。按 PF-02 的量（一次开游戏 160 条 SQL），单次开游戏打约 24 KB 多行日志。
- 修法：默认 `warn`，`format_sql` 只在 `dev` profile 开。这一条改动成本 30 秒，收益立竿见影。

### PF-10 无压缩、封面无 ETag

- `application.yml` 没有 `server.compression.enabled`。本机回环影响小，但老师机当服务器被同教室访问时，345 KB JS + 50 KB CSS 明文传输。
- `GameStoreController.java:98` 只给 `max-age=300`，无 `ETag`，5 分钟后仍要重下封面字节。

### PF-11 索引

现有索引够用（`uk_student_teacher_class_no`、`uk_game_package_game_version`、`local_session.token` 唯一、FK 在 H2 会自动建索引）。**唯一建议新增**：

```sql
create index idx_ledger_student_created on student_points_ledger (student_id, created_at desc);
```

配合 PF-06 的分页，避免「取前 50 条」还要全表排序。

---

## 2. 缺陷清单

> 级别：**P0 严重**（安全/数据丢失，立刻修）｜**P1 高**（功能错误或必然踩到）｜**P2 中**｜**P3 低**

### P0

| ID | 位置 | 现象 | 影响 | 修复 |
|---|---|---|---|---|
| P-01 | `admin/AdminBootstrapRunner.java:33-38` + `application.yml`（无 `server.address`） | 空库自动建 `admin` / **`admin123`**，密码永久不强制改；Tomcat 默认监听 **0.0.0.0:7070** | 同网段任何设备 `http://老师机IP:7070` 用 admin123 登录 → 管理端全权限（改游戏、发码、禁用教师） | ①`server.address: 127.0.0.1`（本地双端只在本机用）；②首启随机密码写日志一次 + 强制改密；③或仅在 `@Profile("dev")` 建默认账号 |
| P-02 | `frontend/src/pages/GamePage.tsx:512` → `game/PluginContentController.java:27` | **主登录 token 直接拼进 iframe URL** 与每个资源 URL；该 token 是**永久会话**（`AuthService.java:36-37`） | URL 会进浏览器历史、Electron 日志、任何中间代理日志；拿到即可完全冒充该教师。`Referrer-Policy: no-referrer` 只挡住第三方，挡不住本机与日志 | 发一个**独立、短时效、限定 gameCode** 的 plugin token（如 10 分钟 JWT/HMAC），`serveFile` 只认它，不认登录 token |
| P-03 | `admin/AdminTeacherService.java:57-70`（改密）、`auth/AuthService.java:168-173`（登出） | 改密 / 禁用 / 重置只改 `app_user`，**不删 `local_session`**；logout 只删当前 token | 密码被重置后，旧 token 仍永久有效 → 「踢不掉人」。禁用有 `requireUserByToken:200` 兜底，改密没有 | 改密/重置/禁用时 `sessionRepository.deleteByUserId(id)`（含新增仓储方法）；前端提示「已强制下线」 |

### P1

| ID | 位置 | 现象 | 影响 | 修复 |
|---|---|---|---|---|
| P-04 | `application.yml:13-14`（10 MB）；现有最大包 `landform_quiz-1.3.0.zip` = **7.09 MB** | 上传上限 10 MB，距现有最大包只剩 2.9 MB 余量；超限抛 `MaxUploadSizeExceededException`，而 `GlobalExceptionHandler.java:158` 只兜 `Exception` | 下一个稍大的游戏包会**上传失败且提示「服务器内部错误」**，无任何可诊断信息 | 上限提到 100 MB（`max-request-size` 同步），并单独 `@ExceptionHandler(MaxUploadSizeExceededException)` 返回 413 + 明确文案 |
| P-05 | `student/StudentService.java:294-300`、`game/GameScoreService.java:72-75` | 「读 totalPoints → 算新值 → 保存」是 check-then-act；`Student` 有 `@Version`，冲突抛 `ObjectOptimisticLockingFailureException` | 双击结算 / 两个标签页同时 +分 → 一个成功一个 **500**，前端提示「服务器内部错误」，老师以为丢分 | ①5xx 重试 2 次（幂等键已具备）或改用 `update student set total_points = total_points + :d where id=? and total_points + :d >= 0`；②`ObjectOptimisticLockingFailureException` 单独映射为 `CONFLICT` 409 |
| P-06 | `game/GameStoreService.java:194-222` | 只在已有权益为 `ACTIVE` 时抛错；若已有 **非 ACTIVE** 权益行，继续 `save` 新行 → 撞 `uk_user_entitlement` | 用户看到一个 400「字段超长或违反唯一约束」（`GlobalExceptionHandler:136` 的兜底文案），完全误导 | `ifPresent` 时统一处理：非 ACTIVE 就 `setStatus("ACTIVE")` 复用同一行 |
| P-07 | `game/PluginPackageService.java:136-137` | 先 `deleteRecursively(targetRoot)` 再解压；中途失败（磁盘满、杀软锁文件） | 旧版本已被删，新版本没解完 → 游戏直接打不开，DB 仍记 `INSTALLED` | 解压到 `targetRoot + ".tmp"`，成功后整体 rename 替换 |
| P-08 | `game/GameStoreService.java:359-366` `uninstallGame` | 先删磁盘再删库行，同一事务；磁盘删成功、DB 回滚（或反之） | 磁盘没了解压文件但 `user_game_install` 还在 → 页面显示已安装、打开 404 | 先删 DB 行并提交，再删文件（失败只记日志，下次安装会覆盖） |
| P-09 | `game/PluginPackageSyncRunner.java:38`；`GamePackageRepository.java:37-40` | runner 会把包标成 `MISSING`，但**没有任何查询按 status 过滤**；`findLatestByGameId` 会把 MISSING 的包当最新版 | 一次临时锁文件就让版本被标 MISSING，商城仍推荐它 → 点安装报「插件包文件不存在」，且永不恢复 | 所有取最新版的地方加 `and status = 'PUBLISHED'`；runner 只对 `Files.exists==false` 标 MISSING |
| P-10 | `student/StudentService.java:75-91`、`:428`、`:388` | 导入时：①逐行 `existsBy`（N 次查询）②每行 `createStudent` 内 `saveAndFlush`（N 次 flush）③整批一个事务，末尾失败全部回滚 | 500 行名单 = 1000+ 次 DB 往返（数十秒）；任何一行撞唯一键 → 整批丢失，只回一句 500 | 一次 `findByTeacherIdAndClassNameIn...` 拉现有键做内存判重；批量 `saveAll` + 单次 flush；失败行返回明细而不是整体回滚 |
| P-11 | `student/StudentService.java:210` vs `:440` | 手工新增 `initialPoints` **完全没有范围校验**（导入路径有 0–99999，手工路径没有） | 可传 `-99999` 或 `2^31-1`，后者 +分直接溢出成负数 | `AddStudentRequest.initialPoints` 加 `@Min(0) @Max(99999)`，service 再兜一次 |
| P-12 | `student/StudentService.java:246-264` | 更新学生时 `totalPoints` 是**客户端绝对覆盖**，且只校验 `< 0`，无上限；同时写一条「差额」流水 | 老师误填 999999999 → 溢出；两人同时编辑 → 后写覆盖前写，流水与实际不一致 | 上限 99999；建议改成「调整」语义（只接受 delta），或加 `@Version` 前端回传做乐观校验 |

### P2

| ID | 位置 | 现象 | 影响 | 修复 |
|---|---|---|---|---|
| P-13 | `cloudproxy/CloudApiProxyController.java:35-46`；`auth/AuthFilter.java:96-100` | `/cloud-api/**` **完全不鉴权**（注释说明是刻意），任何方法体 `readAllBytes` 后转发 | 同网段可当跳板访问云端（需自备云端凭证）；大 body 全量进堆 | 至少校验来源（同源 `Origin`/`Referer` 或本地 token），body 用流式转发 |
| P-14 | `common/GlobalExceptionHandler.java:102-106`、`:158-163` | `BusinessException` 一律 400；`FORBIDDEN`/`UNAUTHORIZED` 也是 400；JSON 解析失败、路径参数类型错、方法不支持、文件超限 全部落到 500 | 前端 `401 → 跳登录` 的逻辑失效；客户端错误被记成服务端错误，排障困难 | 按 code 映射：`UNAUTHORIZED→401`、`FORBIDDEN→403`、`NOT_FOUND→404`；补 `HttpMessageNotReadableException→400`、`MaxUploadSizeExceededException→413` |
| P-15 | `admin/AdminGameService.java:226`、`admin/AdminTeacherService.java:87`、`admin/AdminStatsService.java:37` | `installCount` / `studentCount` / `studentTotal` **硬编码 0** | 管理后台永远显示「0 安装 / 0 学生」，老师会以为数据丢了 | 用现成仓储：`installRepository.countByGameId`、`studentRepository.countByTeacherId`、`studentRepository.count()` |
| P-16 | `admin/AdminTeacherService.java:64` | 新密码只校验 `length >= 6`，无上限 | BCrypt **静默截断 72 字节**：两个前 72 字节相同的长密码都能登录 | 上限 72 字节（或 64 字符）并明确提示 |
| P-17 | `game/PluginPackageService.java:143-158` | 解压无单文件/总大小上限，可被 zip bomb | 恶意包写满磁盘；管理端上传链路可触发 | 累加 `Files.copy` 后的大小，超阈值（如 500 MB）中断并清理 |
| P-18 | `game/GameStoreService.java:396-399` | `zipFile.getInputStream(manifestEntry)` 未 close（只靠 `ZipFile.close`） | 高频取封面时 inflater/句柄堆积 | try-with-resources 包住每个 entry 流 |
| P-19 | `student/ClassManagementService.java:94-97` | 学生是按 `IgnoreCase` 找的，删除却用 `deleteByTeacherIdAndClassName`（**区分大小写**） | 英文班名大小写不一致时删不干净 → FK 约束报错 500 | 统一用 `deleteByTeacherIdAndClassNameIgnoreCase` 或按查出的 id 批量删 |
| P-20 | `game/GameStoreService.java:349-353` | `importDownloadedPackage` 先 `file.getBytes()` 解析 manifest，再调 `installDownloadedPackage` **又 `getBytes()` 一次、又解析一次 zip** | 双倍内存 + 双倍解压扫描（7 MB 包约多 30 ms） | 抽出 `doInstall(gameCode, bytes)` 内部方法，字节只取一次 |
| P-21 | `game/GameStoreService.java:260`、`:369-379` | `installDownloadedPackage` / `downloadPackage` **不校验 entitlement** | 任何登录教师可下载/导入任意（含付费）游戏包并安装，绕开激活码 | 若「离线导入」是有意的，请在文档里写明；否则 `downloadPackage` 加 `ensureEntitlement` |
| P-22 | `game/GameStoreService.java:282,294` | 教师侧上传包时把 `product.status` 强制改成 `ACTIVE` | 管理端设为 DRAFT 的游戏，被教师顺手导入一次就「上架」 | 已存在的商品保留原 status，仅新建时设 ACTIVE |
| P-23 | `settings/SettingsService.java:76-77` | 逐个子目录 `Files.move`，中途失败无回滚；`deleteDirIfEmpty` 还可能删掉旧目录 | 迁移一半失败 → 部分游戏在新目录、部分在旧目录，DB 未变，全部路径错乱 | 先整体校验目标可写 + 记录已移动列表，失败时逆序移回 |

### P3

| ID | 位置 | 现象 |
|---|---|---|
| P-24 | `auth/AuthService.java:134` | 登录无失败计数/延迟，可无限撞库；本地单机风险有限，但端口若被暴露（见 P-01）就很危险 |
| P-25 | `auth/AuthService.java:135-141` | 用户不存在时跳过 BCrypt（提前 return），存在时才算 → **响应时间差可枚举用户名** |
| P-26 | `student/StudentService.java:453-506` | Excel 解析无行数上限，`sheet.getLastRowNum()` 可被稀疏表头撑到百万级空转 |
| P-27 | `game/GameStoreService.java:605-645` `syncManifestTags` | 每个新标签都 `tagRepository.count()`；每条关联单独 `save`（无 `saveAll`） |
| P-28 | `common/GlobalExceptionHandler.java:136` | 唯一约束冲突的用户文案是「字段超长」，与实际原因不符 |
| P-29 | `admin/AdminCodeService.java:38` | `findAllByOrderByCreatedAtDesc` 无分页，码多了会全量返回 |

---

## 3. 必要修复 vs 可选优化

**必要（P0/P1，建议本版内完成）**：P-01、P-02、P-03、P-04、P-05、P-06、P-07、P-08、P-09、P-10、P-11、P-12
**可选（P2，按需排）**：P-13 ~ P-23
**低收益（P3）**：P-24 ~ P-29

性能侧：PF-01、PF-02、PF-09 是「必要」；PF-03 ~ PF-08 是「值得做」；PF-10、PF-11 是「顺手做」。

---

## 4. 建议落地顺序（三批）

**第 1 批 · 30 分钟，零风险，体感立刻变**（只改配置 + 一处缓存头）
1. `PluginPackageSyncRunner` 加「已算过就跳过」（PF-01）
2. `application.yml`：SQL 日志降级 + `server.address: 127.0.0.1`（PF-09、P-01 的一半）
3. `PluginContentController`：`noStore()` → `private, max-age=31536000, immutable`（PF-02 的第 1 步）
4. 上传上限 10 → 100 MB + 413 处理（P-04）

**第 2 批 · 半天，安全与正确性**
5. 独立 plugin token（P-02）
6. 改密/禁用/重置时清会话（P-03）
7. 积分并发：原子自增 + 409 映射（P-05）
8. 兑换复用非 ACTIVE 权益（P-06）
9. 解压先 tmp 后 rename（P-07）、卸载顺序（P-08）、MISSING 过滤（P-09）

**第 3 批 · 一天，批量查询与内存**
10. 五处 N+1（PF-05）+ 导入批量化（P-10）
11. 流水分页 + 索引（PF-06、PF-11）
12. 插件/包文件流式返回（PF-07）、封面内存缓存 + ETag（PF-03）
13. 事务内文件 I/O 外移（PF-08）

---

## 5. 验收方法

| 项 | 怎么验 |
|---|---|
| PF-01 | 启动前后对比 `plugins/packages` 的读字节数（资源监视器）；或在 `run()` 首尾打时间戳，应 < 200 ms |
| PF-02 | DevTools Network：第二次开同一游戏，插件资源应全部 `(disk cache)`，`Transfer Size = 0` |
| PF-02 查询数 | 临时开 `org.hibernate.SQL: debug`，开一次游戏统计 `select` 条数，应从 O(资源数×4) 降到常数 |
| P-04 | 传一个 20 MB 的构造函数包，应成功；传 200 MB 应返回 **413 + 明确文案**，不是 500 |
| P-05 | 同一 `roundId` 并发 POST 两次 `/api/v1/games/{code}/scores`，应一次 `recorded:true` 一次 `recorded:false`，均非 500 |
| P-03 | 管理端重置某教师密码后，用旧 token 调 `/api/v1/auth/me` 应 401 |
| P-01 | 从另一台机器访问 `http://<本机IP>:7070` 应连接被拒 |
