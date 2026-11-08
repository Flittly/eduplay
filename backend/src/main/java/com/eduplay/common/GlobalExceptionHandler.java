package com.eduplay.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 前端构建产物里的单页入口 */
    private static final String FRONTEND_INDEX = "static/index.html";

    /** H2 的超长报错：Value too long for column "description CHARACTER VARYING(512)" */
    private static final Pattern H2_TOO_LONG =
            Pattern.compile("Value too long for column \"([A-Za-z0-9_]+)", Pattern.CASE_INSENSITIVE);

    /** MySQL 的超长报错：Data too long for column 'description' at row 1 */
    private static final Pattern MYSQL_TOO_LONG =
            Pattern.compile("Data too long for column '([A-Za-z0-9_]+)'", Pattern.CASE_INSENSITIVE);

    /**
     * 前端路由兜底（SPA fallback）。
     *
     * 前端是单页应用：/game/xxx、/teacher/points 这类地址在磁盘上**没有对应文件**，
     * 它们只在浏览器里由前端路由接管。但「刷新页面」和「直接输入/粘贴深链接」都会
     * 把这些地址原样再请求一次，于是落到静态资源处理器、找不到文件、
     * 抛 NoResourceFoundException —— 若不单独处理，就会被下面的兜底
     * 捕获成 500 + JSON，用户看到的是一坨接口错误而不是页面
     * （桌面端刷新变白屏就是这个原因）。
     *
     * 约定：
     *   看起来像前端路由 ⇒ 回 index.html，交回前端路由（刷新后停在原页面）；
     *   其余（/api/**、带扩展名的静态文件）⇒ 老老实实 404 + JSON，
     *   不能把 HTML 冒充成接口响应或 JS 文件。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<?> handleMissingResource(NoResourceFoundException ex,
                                                   HttpServletRequest request) {
        if (!looksLikeFrontendRoute(request.getRequestURI())) {
            log.debug("未匹配到任何资源或接口：{}", ex.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("NOT_FOUND", "接口不存在"));
        }

        Resource index = new ClassPathResource(FRONTEND_INDEX);
        if (!index.exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ApiResponse.error("NOT_FOUND", "前端资源缺失，请先执行前端构建并重新打包后端"));
        }

        // 入口 HTML 必须不缓存：它的作用就是「刷新时拿到最新的资源清单」，
        // 这里走 noStore 比全局的 no-cache 更严；真正需要长期缓存的是带内容 hash 的
        // /assets/**，由 StaticResourceCacheConfig 单独钉成 max-age=1y。
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noStore())
                .body(index);
    }

    /**
     * 判断一个请求路径是不是「前端路由」而不是「静态文件」。
     * 判据刻意保守：宁可让它 404，也不要把 index.html 当成 js 返回。
     */
    private static boolean looksLikeFrontendRoute(String uri) {
        if (uri == null || uri.isEmpty() || "/".equals(uri)) {
            return false;
        }
        String path = uri.startsWith("/") ? uri.substring(1) : uri;
        // 接口与框架内部路径不兜底
        if (path.equals("error") || path.startsWith("error/")
                || path.startsWith("api/") || path.startsWith("actuator/")) {
            return false;
        }
        // 末段带点号的一律按静态文件看待（assets/index-xxx.css、logo.png、favicon.ico…）
        String lastSegment = path.substring(path.lastIndexOf('/') + 1);
        return !lastSegment.isEmpty() && !lastSegment.contains(".");
    }

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
