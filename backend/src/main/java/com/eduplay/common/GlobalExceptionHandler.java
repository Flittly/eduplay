package com.eduplay.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 前端构建产物里的单页入口 */
    private static final String FRONTEND_INDEX = "static/index.html";

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
        // 真正需要长期缓存的静态资源带内容 hash，按原样走默认策略即可。
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

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnknown(Exception ex) {
        log.error("Unhandled server error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("INTERNAL_ERROR", "服务器内部错误"));
    }
}
