# 游戏商城与插件包

## 当前能力

- 游戏商城列出所有已发布的游戏。
- 游戏状态包括：未拥有、已拥有、未安装、已安装、可更新。
- 激活码兑换权益。
- 安装时实际读取 zip 插件包并解压到本地插件目录。
- 卸载时删除已安装目录。
- 版本更新通过比较已安装版本与最新发布版本判断。

## 插件包

包目录：

```text
backend/plugins/packages/{gameCode}-{version}.zip
```

安装目录：

```text
backend/plugins/installed/{userId}/{gameCode}/{version}
```

## 测试激活码

```text
PROVINCE-PUZZLE-2026
```

激活码只能使用一次。

## 已购权益

`user_entitlement` 记录教师与游戏的权益关系，来源为激活码。

只有拥有权益的教师才能安装对应游戏。

## 说明

当前激活码替代线上支付。后续接入真实支付后，`user_entitlement.source` 可以扩展为 `ORDER`、`FREE` 等。
