# 本地 + 云端双存储设计：用户与积分

## 1. 产品模型

平台使用者是教师。

学生是教师名下的名单数据，不登录平台。

积分属于学生，由教师管理。

所以这里设计的“用户与积分”指：

- 教师账号
- 学生名单
- 学生积分与积分流水

## 2. 存储策略

推荐采用：

```text
MySQL（云端） = 云端权威数据源
H2（本地）     = 离线工作副本
```

教师电脑有网络时，本地 H2 和云端 MySQL 同时工作。

断网时，教师继续使用本地 H2。

恢复网络后，本地变更自动同步到云端。

## 3. 为什么不能做成真正的“双库事务”

你不能在一个数据库事务里同时提交 H2 和 MySQL。

因为它们是两个独立数据库，无法保证原子性：

```text
H2 成功，MySQL 失败
MySQL 成功，H2 失败
```

所以正确做法不是同步写入，而是：

```text
本地先记录变更
  ↓
有网络时把变更同步给云端
```

这种模式叫 Outbox + 最终一致。

## 4. 数据模型

### 教师账号

```text
cloud_user
- cloud_user_id
- username
- password_hash
- nickname
- teacher_no
- status
- created_at
- updated_at
```

本地有一份映射：

```text
local_user_profile
- local_user_id
- cloud_user_id
- last_sync_at
```

教师第一次云端登录后，本地保存 cloud_user_id。

之后即使离线，也知道自己对应的云端身份。

### 学生名单

学生使用全局稳定的 `sync_id`，而不是依赖本地自增主键同步：

```text
student
- sync_id UUID
- owner_cloud_user_id
- student_no
- name
- class_name
- is_deleted
- updated_at
```

本地和云端使用同一个 sync_id。

删除采用软删除，避免另一台电脑同步时重新出现已删除的学生。

### 积分流水

积分流水是“只追加”数据，不允许修改和删除：

```text
student_points_ledger
- sync_id UUID
- student_sync_id
- owner_cloud_user_id
- amount
- reason
- biz_type
- occurred_at
- idempotency_key
```

学生总积分：

```text
total_points = sum(amount)
```

总积分只是缓存，真正可靠的数据是流水。

## 5. 为什么积分用流水而不是只存余额

如果只存“学生当前积分 = 120”，同步时会很难判断：

- 这个 120 是哪台电脑算出来的？
- 是否重复同步了？
- 某个修改是先发生还是后发生？

如果存流水，每条记录都有唯一 sync_id：

```text
张三 +10
张三 +20
张三 -5
```

合并时按 sync_id 去重，永远不会重复加分。

## 6. 本地变更记录

每次本地修改学生或积分时，同时写入：

```text
sync_outbox
- id
- entity_type: STUDENT / POINTS_LEDGER / GAME_INSTALL
- sync_id
- operation: UPSERT / DELETE
- payload_json
- created_at
- synced_at
```

网络恢复后，服务读取未同步的 outbox，提交给云端。

## 7. 同步流程

### 检测网络

```text
应用启动
  ↓
请求 GET /api/v1/health
  ↓
成功 = 有网络
失败 = 离线模式
```

Electron 桌面版也可以监听网络状态变化，在线后自动同步。

### 推送本地变更

```text
读取本地未同步的 sync_outbox
  ↓
POST /api/v1/sync/push
  ↓
云端按 sync_id 去重写入
  ↓
返回成功记录
  ↓
本地把 synced_at 标记为已同步
```

### 拉取云端变更

```text
GET /api/v1/sync/pull?after=上次同步时间
  ↓
返回云端新增或修改
  ↓
本地按 sync_id 应用
  ↓
更新 last_sync_at
```

## 8. 冲突处理规则

### 积分流水

不存在冲突，因为只追加、按 sync_id 去重。

### 学生名单

同一学生的修改，以 `updated_at` 较新的为准：

```text
电脑A：09:00 修改班级
电脑B：10:00 修改姓名
```

同步后最终以电脑B的 updated_at 为准。

### 删除学生

使用软删除：

```text
is_deleted = true
```

这样其他电脑同步时不会把已删除学生又加回来。

## 9. 建议接口

```text
GET  /api/v1/health
POST /api/v1/sync/push
GET  /api/v1/sync/pull
GET  /api/v1/sync/state
```

## 10. 云端服务器配置

小型开发者不需要太大服务器。

推荐起步：

```text
CPU：1-2 核
内存：2GB
硬盘：40GB SSD
系统：Linux
数据库：MySQL 8
```

积分流水数据量很小：

- 一条积分流水大约 100 字节。
- 1 万条约 1MB。
- 100 万条约 100MB。

普通教师一年产生的积分记录远小于 100 万条。

所以“积分占用很多内存”不用担心。

真正占用空间的是插件包，例如：

```text
province_puzzle-0.1.0.zip 约 5KB
```

即使后续游戏包含图片、音频，单个插件包几 MB 到几十 MB，小型服务器也足够。

## 11. 实现顺序建议

1. 在本地表和 MySQL 表中增加 sync_id、updated_at、is_deleted。
2. 积分改为只追加流水，学生总积分按流水计算。
3. 增加 sync_outbox 表。
4. 实现 push / pull 接口。
5. 开发桌面版后接入网络状态监听和自动同步。

## 12. 上千人使用时的最小数据设计

如果以后有 1000 位教师，数据增长主要来自：

- 学生名单
- 学生积分流水
- 游戏会话记录
- 同步暂存记录

教师数量本身不是压力，压力在于每位教师下面的学生和记录。

### 数据量估算

假设 1000 位教师，每人平均 50 名学生：

```text
学生总数 = 5 万
```

如果每个学生一年产生 200 条积分/游戏记录：

```text
一年流水 = 5万 × 200 = 1000 万条
```

这个量 MySQL 可以处理，但必须做最小化设计，否则几年后数据库会越来越大。

### 最小化设计规则

#### 积分流水尽量短

不要每行保存完整原因文本：

```text
reason = "教师在课堂上奖励学生认真回答问题"
```

而应该保存简短的原因代码：

```text
reason_code = 1 表示课堂奖励
reason_code = 2 表示游戏完成
reason_code = 3 表示手动扣分
```

原因说明可以只存一次，不要存在每一条流水里。

#### 积分流水字段最小化

建议字段：

```text
sync_id         全局唯一
student_sync_id 学生标识
amount          变动积分
reason_code     原因代码
biz_id          关联的游戏会话或来源记录
occurred_at     发生时间
idempotency_key 防重复
```

不要把 score、total_points 等冗余字段重复写入每一条流水。

#### 总积分只保存一份

学生表保存：

```text
total_points
```

这只是一份缓存，查询时不实时 `sum` 所有流水，减轻数据库压力。

#### 同步记录及时清理

`sync_outbox` 是临时表，不应长期保留。

建议：

```text
同步成功后
  ↓
保留最近 7 天或 1000 条
  ↓
定期清理
```

不要让它无限增长。

#### 游戏会话只保存结果

不建议保存：

```text
游戏过程中的每一步操作
```

建议只保存：

```text
游戏编号
学生编号
得分
正确数
总题数
完成时间
游戏版本
```

### 数据归档策略

每个学期结束时，可以把旧数据归档：

```text
当前学年数据：继续在 MySQL
上学期数据：导出备份或移到归档表
```

也可以按年份分区：

```text
points_ledger_2025
points_ledger_2026
```

这样查询本学期积分时不需要扫描历史数据。

### 索引不要滥用

只给高频查询加索引：

```text
student_id + reason_code
idempotency_key
student_sync_id
sync_id
```

不要给每个字段都加索引。

### 避免把大数据放进数据库

插件包、图片、音频不要存 MySQL，应该存文件系统或对象存储：

```text
MySQL：存文件路径、大小、哈希
文件系统：存实际文件
```

### 本地与云端复制策略

本地保存完整离线数据。

云端作为权威数据源，可以只保留有效数据，不保留可以本地恢复的历史日志。

## 13. 达到什么规模才需要换架构

MySQL 对以下规模仍然足够：

```text
1000 位教师
5 万学生
年流水 1000 万条
```

只要遵循最小化字段、索引和归档规则即可。

如果未来出现：

```text
同时在线数千人
年流水过亿
多人同时修改同一个班级
```

再考虑：

- 读写分离
- 分表分库
- 把积分流水迁移到分布式数据库

现阶段不建议一开始就上这些复杂架构。
