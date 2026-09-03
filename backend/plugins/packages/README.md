# EduPlay 插件包目录

此目录存放已发布的游戏插件包。

## 插件包格式

包名格式：

```text
{game_code}-{version}.zip
```

例如：

```text
province_puzzle-0.1.0.zip
```

zip 内部结构：

```text
manifest.json
web/
├── index.js
└── index.css
```

## 安装到本地

在商城兑换激活码后点击安装，后端会：

1. 从 `packages` 目录读取插件包。
2. 校验 SHA256。
3. 解压到 `plugins/installed/{userId}/{gameCode}/{version}`。
4. 更新本地安装记录。

## 测试激活码

```text
PROVINCE-PUZZLE-2026
```
