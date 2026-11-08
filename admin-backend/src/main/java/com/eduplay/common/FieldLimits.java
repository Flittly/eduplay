package com.eduplay.common;

/**
 * 与数据库列宽对齐的字段长度约束。
 *
 * <p>数字来源是 db/migration 里 game_product 的建表语句：
 * game_code 64 / name 128 / description 512 / entry 255 / version 32。
 * 这些上限过去只写在 DDL 里，应用层一个字都不拦 —— 超长的简介能一路走到
 * 数据库，被 H2 / MySQL 拒绝时抛的是 SQL 层的 DataIntegrityViolation，
 * 客户端只看到一句「服务器内部错误」，既不知道是哪个字段、也不知道超了多少。
 *
 * <p>纪律：这里的每个数字必须与迁移脚本一致；改列宽时两处一起改。
 */
public final class FieldLimits {

    public static final int GAME_CODE = 64;
    public static final int NAME = 128;
    public static final int DESCRIPTION = 512;
    public static final int ENTRY = 255;
    public static final int VERSION = 32;

    private FieldLimits() {
    }

    /**
     * 允许为空；超长则抛出带字数差异的业务异常。
     *
     * <p>按码点数比较（不是 String.length）：varchar(n) 在 H2 / MySQL utf8mb4 下
     * 数的是字符，代理对（emoji 之类）算一个，与 length() 会差一格。
     */
    public static void check(String label, String value, int max) {
        if (value == null) {
            return;
        }
        int length = value.codePointCount(0, value.length());
        if (length > max) {
            throw new BusinessException(
                    "FIELD_TOO_LONG",
                    label + "最多 " + max + " 字，当前 " + length + " 字"
            );
        }
    }

    /** 必填且不超长，返回去掉首尾空白的值。 */
    public static String requireText(String label, String value, int max) {
        if (value == null || value.isBlank()) {
            throw new BusinessException("FIELD_REQUIRED", label + "不能为空");
        }
        check(label, value, max);
        return value.trim();
    }
}
