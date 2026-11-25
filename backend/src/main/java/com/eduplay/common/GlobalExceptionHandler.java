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
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
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
     * 唯一键 / 主键冲突。H2 是
     * {@code Unique index or primary key violation}／{@code Referential integrity constraint violation}，
     * MySQL 是 {@code Duplicate entry 'x' for key 'uk_xxx'}。
     *
     * <p>⚠ 这一段必须与「字段超长」分开判：两者都是 {@link DataIntegrityViolationException}，
     * 原先只按「有没有抓到列名」区分，唯一键冲突抓不到列名，就统一成了
     * 「字段超长或违反唯一约束」——兑换激活码撞唯一键时，用户看到的是让他去改字段长度。
     */
    private static final Pattern CONSTRAINT_VIOLATION = Pattern.compile(
            "unique index|duplicate entry|primary key|integrity constraint violation",
            Pattern.CASE_INSENSITIVE
    );

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
        // 接口与框架内部路径不兜底。
        // ⚠ 必须写 "api"、"cloud-api" 这两个**不带斜杠**的裸形式：`/api`（少打一个 v1）和
        // `/cloud-api` 这类请求原先会漏到下面，被当成前端路由返回 index.html + 200，
        // 调接口的人拿到的是一坨 HTML，报错信息完全对不上。
        if (path.equals("error") || path.startsWith("error/")
                || path.equals("api") || path.startsWith("api/")
                || path.equals("cloud-api") || path.startsWith("cloud-api/")
                || path.startsWith("actuator/")) {
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

    /**
     * 业务异常的状态码映射。
     *
     * <p>原先**一律**返回 400：`UNAUTHORIZED` 也是 400，于是前端「401 才清凭证」的分支
     * 永远不会触发 —— 令牌失效时界面停在原地报「请先登录」，点不动也退不出。
     *
     * <p>注意 403 的语义：**已登录但没有权限**，不等于会话失效，前端不该清凭证。
     * 因此这里只把真正的无权操作映射成 403，凭证过期一律是 401。
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        return ResponseEntity.status(statusFor(ex.getCode()))
                .body(ApiResponse.error(ex.getCode(), ex.getMessage()));
    }

    private static HttpStatus statusFor(String code) {
        if (code == null) {
            return HttpStatus.BAD_REQUEST;
        }
        return switch (code) {
            // 账号被禁用与凭证失效归为同一类：会话已经不该继续用，
            // 前端收到 401 会清凭证并回到登录页（错误文案里仍会说明原因）。
            case "UNAUTHORIZED", "ACCOUNT_DISABLED" -> HttpStatus.UNAUTHORIZED;
            case "FORBIDDEN" -> HttpStatus.FORBIDDEN;
            case "GAME_NOT_FOUND", "PACKAGE_NOT_FOUND", "COVER_NOT_FOUND",
                 "MANIFEST_NOT_FOUND", "PLUGIN_FILE_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
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

        // 唯一键 / 外键冲突优先判：这类错误抓不到列名，落到下面的「字段超长」分支
        // 会把「激活码已兑换过」说成「请缩短字段内容」，排查方向直接跑偏。
        if (cause != null && CONSTRAINT_VIOLATION.matcher(cause).find()) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error(
                            "DATA_CONFLICT",
                            "数据与现有记录冲突（可能已存在或仍被引用），请刷新后重试"
                    ));
        }

        String column = extractColumn(cause);
        String message = column == null
                ? "数据无法写入数据库：请检查各字段长度"
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

    // ------------------------------------------------------------------
    // 下面这几类在改造前全部落进兜底 Exception → 500「服务器内部错误」。
    // 它们其实是「请求本身有问题」，客户端完全可以自行修正，必须给出可读原因。
    // ------------------------------------------------------------------

    /** 上传超过 spring.servlet.multipart.max-file-size。 */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        log.warn("上传被拒绝（超出体积上限）：{}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(ApiResponse.error("FILE_TOO_LARGE", "文件超过上传上限，请压缩后重试"));
    }

    /** 请求体不是合法 JSON、字段类型对不上。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.debug("请求体解析失败：{}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ApiResponse.error("INVALID_REQUEST_BODY", "请求内容格式不正确"));
    }

    /** 路径变量/查询参数类型不对（例如 /students/abc）。 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.badRequest().body(ApiResponse.error(
                "INVALID_PARAMETER",
                "参数 " + ex.getName() + " 的格式不正确"
        ));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingParameter(
            MissingServletRequestParameterException ex
    ) {
        return ResponseEntity.badRequest().body(ApiResponse.error(
                "MISSING_PARAMETER",
                "缺少必需参数：" + ex.getParameterName()
        ));
    }

    /** multipart 请求里缺了文件字段（前端 FormData 名字写错就是这样）。 */
    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingPart(MissingServletRequestPartException ex) {
        return ResponseEntity.badRequest().body(ApiResponse.error(
                "MISSING_FILE",
                "请求中缺少文件字段：" + ex.getRequestPartName()
        ));
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ApiResponse<Void>> handleMultipart(MultipartException ex) {
        log.warn("multipart 请求解析失败：{}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ApiResponse.error("INVALID_UPLOAD", "上传内容无法解析"));
    }

    /** 方法用错（例如用 GET 调了只接受 POST 的接口）。 */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotSupported(
            HttpRequestMethodNotSupportedException ex
    ) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ApiResponse.error("METHOD_NOT_ALLOWED", "该接口不支持 " + ex.getMethod() + " 请求"));
    }

    /**
     * Content-Type 不支持（例如往 multipart 接口发了
     * {@code application/x-www-form-urlencoded}）。
     *
     * <p>这类"客户端把格式写错了"的问题原来会掉进兜底的 500，日志里刷一条
     * ERROR 级别的堆栈，而前端只看到"服务器内部错误"—— 排查方向完全跑偏。
     * 415 才是准确的答法：问题出在请求头，不在服务端。
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMediaTypeNotSupported(
            HttpMediaTypeNotSupportedException ex
    ) {
        String received = ex.getContentType() == null ? "未知" : ex.getContentType().toString();
        log.warn("请求 Content-Type 不被支持：{}", received);
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(ApiResponse.error(
                        "UNSUPPORTED_MEDIA_TYPE",
                        "该接口不接受 " + received + " 格式的请求体"
                ));
    }

    /** 请求能处理，但产不出客户端 Accept 要求的类型（例如只要 text/plain）。 */
    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<ApiResponse<Void>> handleMediaTypeNotAcceptable(
            HttpMediaTypeNotAcceptableException ex
    ) {
        log.warn("无法产出客户端 Accept 的响应类型：{}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE)
                .body(ApiResponse.error("NOT_ACCEPTABLE", "接口无法返回 Accept 要求的格式"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception ex) {
        log.error("Unhandled server error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("INTERNAL_ERROR", "服务器内部错误"));
    }
}
