package com.eduplay;

import com.eduplay.common.ApiResponse;
import com.eduplay.common.BusinessException;
import com.eduplay.common.FieldLimits;
import com.eduplay.common.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 两个防线的单元测试：
 * 入库前的长度校验（FieldLimits），以及数据库拒收时的可读报错（GlobalExceptionHandler）。
 *
 * <p>背景：v1.0.0 上架时简介写到 571 字，越过了 game_product.description 的
 * varchar(512)。当时既没有前置校验，数据库的「Value too long」又被兜底处理器
 * 压成了「服务器内部错误」，与接口路径写错完全无法区分。
 */
class FieldLimitsTests {

    @Test
    void 恰好等于上限时放行() {
        FieldLimits.check("简介", "字".repeat(FieldLimits.DESCRIPTION), FieldLimits.DESCRIPTION);
    }

    @Test
    void 超出一个字就拒绝并说清差多少() {
        String tooLong = "字".repeat(FieldLimits.DESCRIPTION + 59);
        BusinessException ex = assertThrows(
                BusinessException.class,
                () -> FieldLimits.check("简介", tooLong, FieldLimits.DESCRIPTION)
        );
        assertEquals("FIELD_TOO_LONG", ex.getCode());
        assertEquals("简介最多 512 字，当前 571 字", ex.getMessage());
    }

    @Test
    void 空值不参与长度校验() {
        FieldLimits.check("简介", null, FieldLimits.DESCRIPTION);
    }

    @Test
    void 一个表情算一个字() {
        // 代理对在 String.length() 里占 2，varchar 数的是字符；按码点比较才不会误判
        String emoji = "🎋".repeat(FieldLimits.DESCRIPTION);
        FieldLimits.check("简介", emoji, FieldLimits.DESCRIPTION);
    }

    @Test
    void 必填字段不给就报错() {
        BusinessException ex = assertThrows(
                BusinessException.class,
                () -> FieldLimits.requireText("名称", "   ", FieldLimits.NAME)
        );
        assertEquals("FIELD_REQUIRED", ex.getCode());
        assertEquals("名称不能为空", ex.getMessage());
    }

    @Test
    void 数据库超长_把H2的列名带出去() {
        String h2 = "Value too long for column "
                + "\"description CHARACTER VARYING(512)\": \"U&'…' (571)\"; SQL statement: …";
        ResponseEntity<ApiResponse<Void>> response = handle(h2);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("DATA_INTEGRITY_VIOLATION", response.getBody().code());
        assertTrue(response.getBody().message().contains("description"),
                "报错里要能看出是哪个字段：" + response.getBody().message());
        assertTrue(response.getBody().message().contains("列宽"),
                "报错里要能看出是超长：" + response.getBody().message());
    }

    @Test
    void 数据库超长_把MySQL的列名带出去() {
        ResponseEntity<ApiResponse<Void>> response = handle(
                "Data too long for column 'description' at row 1");

        assertEquals(400, response.getStatusCode().value());
        assertTrue(response.getBody().message().contains("description"));
    }

    @Test
    void 唯一键冲突要说清是重复而不是字段超长() {
        ResponseEntity<ApiResponse<Void>> response = handle(
                "Unique index or primary key violation: \"PRIMARY_KEY_8 ON PUBLIC.APP_USER(USERNAME)\"");

        // 唯一键冲突与「列超长」是两种完全不同的原因，必须分开：
        // 之前两者都落成 400 + 同一句话，用户看到"请缩短字段内容"，
        // 而实际问题是他要兑换的激活码已经被用过、或者权益行已经存在。
        assertEquals(409, response.getStatusCode().value());
        assertEquals("DATA_CONFLICT", response.getBody().code());
        assertTrue(response.getBody().message().contains("冲突"));
    }

    private static ResponseEntity<ApiResponse<Void>> handle(String causeMessage) {
        DataIntegrityViolationException ex =
                new DataIntegrityViolationException("could not execute statement",
                        new IllegalStateException(causeMessage));
        return new GlobalExceptionHandler().handleDataIntegrity(ex);
    }
}
