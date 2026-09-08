# 游戏插件加载与统一积分协议

## 目标

平台可以动态加载已安装的游戏插件，而不用把每个游戏的源码编译进平台前端。所有游戏都通过同一套消息协议和积分接口结算积分。

## 插件形态

游戏是一个 zip 插件包，内部结构如下：

```text
province_puzzle-0.1.0.zip
├── manifest.json
└── web/
    ├── index.html
    └── assets/
        ├── index-xxxx.css
        └── index-xxxx.js
```

`manifest.json` 是插件契约：

```json
{
  "gameCode": "province_puzzle",
  "name": "行政区拼图",
  "version": "0.1.0",
  "minPlatformVersion": "0.1.0",
  "maxPlatformVersion": "1.0.0",
  "type": "iframe",
  "sdkVersion": "1",
  "entry": "web/index.html",
  "backendPlugin": null,
  "description": "拖动省级行政区到地图上的正确位置，认识中国省级行政区。"
}
```

- `type` 固定为 `iframe`，表示由平台用内嵌网页加载；
- `entry` 是插件包内的入口文件，相对于 zip 根目录；
- `backendPlugin` 暂时为 `null`，后续可扩展后端插件钩子。

## 动态加载流程

1. 教师在游戏中心选择已安装游戏；
2. 平台调用 `GET /api/v1/store/games/{gameCode}/manifest` 获取入口；
3. 平台构造带会话令牌的资源地址：
   `GET /api/v1/plugin/{token}/{gameCode}/{version}/{entry}`；
4. 前端使用 `<iframe>` 加载该地址；
5. 游戏与平台通过 `postMessage` 通信。

插件静态文件由后端按会话校验后从本地安装目录读取，版本写入地址，天然解决缓存更新问题。

## 消息协议

平台发给游戏（游戏加载并发送 READY 后）：

```json
{
  "source": "eduplay-platform",
  "type": "GAME_INIT",
  "payload": {
    "gameCode": "province_puzzle",
    "version": "0.1.0",
    "studentId": 12,
    "studentName": "张三",
    "className": "高一1班"
  }
}
```

游戏发给平台：

```json
{
  "source": "eduplay-game",
  "type": "GAME_READY",
  "payload": {
    "gameCode": "province_puzzle",
    "version": "0.1.0"
  }
}
```

```json
{
  "source": "eduplay-game",
  "type": "GAME_COMPLETE",
  "payload": {
    "roundId": "d0ff...uuid",
    "score": 60,
    "correctCount": 6,
    "totalCount": 6
  }
}
```

`roundId` 由游戏生成，用于幂等，防止同一局重复提交造成重复加分。

## 统一积分接口

平台收到 `GAME_COMPLETE` 后调用：

```text
POST /api/v1/games/{gameCode}/scores
Authorization: Bearer {token}
Content-Type: application/json
```

请求体：

```json
{
  "studentId": 12,
  "score": 60,
  "roundId": "d0ff...uuid"
}
```

响应：

```json
{
  "success": true,
  "code": "OK",
  "message": "success",
  "data": {
    "id": 12,
    "name": "张三",
    "studentNo": "20260001",
    "className": "高一1班",
    "totalPoints": 160,
    "score": 60,
    "recorded": true
  }
}
```

后端只增加学生积分并写入一条积分流水，不保存对局详情：

- `student.total_points` 增加 `score`；
- `student_points_ledger` 新增 `GAME_EARN / GAME_SCORE` 流水；
- `idempotency_key` 保证同一 `roundId` 不会重复加分。

## 开发新游戏的约束

1. 游戏包必须包含 `manifest.json`，并声明 `type=iframe`、`entry`；
2. 前端入口加载后向父窗口发送 `GAME_READY`；
3. 游戏结束时发送 `GAME_COMPLETE`，携带 `roundId`、`score`、可选 `correctCount`、`totalCount`；
4. 游戏不直接访问数据库，只通过平台统一积分接口结算；
5. 游戏内如需平台数据，应从 `GAME_INIT` 的 `payload` 中读取。
