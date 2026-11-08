package com.eduplay.common;

import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** H2 的超长报错：Value too long for column "description CHARACTER VARYING(512)" */
    private static final Pattern H2_TOO_LONG =
            Pattern.compile("Value too long for column \"([A-Za-z0-9_]+)", Pattern.CASE_INSENSITIVE);

    /** MySQL 的超长报错：Data too long for column 'description' at row 1 */
    private static final Pattern MYSQL_TOO_LONG =
            Pattern.compile("Data too long for column '([A-Za-z0-9_]+)'", Pattern.CASE_INSENSITIVE);

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error("NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .orElse("请求参数不合法");
        return ResponseEntity.badRequest()
                .body(ApiResponse.error("VALIDATION_ERROR", message));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConstraint(ConstraintViolationException ex) {
        return ResponseEntity.badRequest()
                .body(ApiResponse.error("VALIDATION_ERROR", ex.getMessage()));
    }

    /**
     * 写库被数据库拒绝：最常见的是某个字段超了 varchar(n) 的列宽。
     *
     * <p>不单独接这一段，它就会掉进下面的兜底，客户端只收到一句「服务器内部错误」——
     * 与路由写错、空指针完全无法区分（v1.0.0 上架时正是卡在这里，白查了半小时网络）。
     * 这里把列名与原因一起带出去；日志里留原文，方便对 SQL 层排查。
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataIntegrity(DataIntegrityViolationException ex) {
        String cause = ex.getMostSpecificCause().getMessage();
        log.warn("写入数据库被拒绝：{}", cause);
        String column = extractColumn(cause);
        String message = column == null
                ? "数据无法写入数据库：字段超长或违反唯一约束，请检查各字段长度"
                : "字段 " + column + " 的内容超过数据库列宽限制，请缩短后重试";
        return ResponseEntity.badRequest()
                .body(ApiResponse.error("DATA_INTEGRITY_VIOLATION", message));
    }

    private static String extractColumn(String message) {
        if (message == null) {
            return null;
        }
        Matcher h2 = H2_TOO_LONG.matcher(message);
        if (h2.find()) {
            return h2.group(1);
        }
        Matcher mysql = MYSQL_TOO_LONG.matcher(message);
        if (mysql.find()) {
            return mysql.group(1);
        }
        return null;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception ex) {
        log.error("Unhandled server error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("INTERNAL_ERROR", "服务器内部错误"));
    }
}
