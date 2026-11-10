package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 统一认证入口：除白名单外，任何请求都必须带有效 Bearer token。
 *
 * <p>在这之前，鉴权是 20 处手工调用 {@code requireUser}/{@code requireAdmin} 拼起来的，
 * 只要新增接口时忘了写那一行，接口就是裸的。改成过滤器后默认行为是“拒绝”，
 * 忘记配置的后果从“漏鉴权”变成“访问不了”，错得更安全。
 *
 * <p>两道规则：
 * <ol>
 *   <li>认证：token 无效 / 过期 → 401；</li>
 *   <li>授权：{@code /api/v1/admin/**} 默认只允许 SUPER_ADMIN → 403。</li>
 * </ol>
 * 白名单只有登录、注册、登出、健康检查、以及封面图（{@code <img>} 标签带不了 token）。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
public class AuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AuthFilter.class);

    private static final String BEARER_PREFIX = "Bearer ";

    /** 管理员专属前缀：除白名单外，这里要求 SUPER_ADMIN。 */
    private static final String ADMIN_PREFIX = "/api/v1/admin/";

    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    /**
     * 无需登录即可访问的路径。
     *
     * <p>其中登出接口刻意公开：token 过期后点退出不该报错，
     * 删除一条已知的 token 本身也不需要证明自己还有效。
     */
    private static final List<String> PUBLIC_PATHS = List.of(
            "/error",
            "/error/**",
            "/api/v1/health",
            "/api/v1/health/**",
            "/api/v1/auth/local/login",
            "/api/v1/auth/local/register",
            "/api/v1/auth/logout",
            "/api/v1/admin/login",
            "/api/v1/admin/logout",
            "/api/v1/store/games/*/cover"
    );

    private final AuthService authService;

    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // 预检请求不带业务凭证，直接放行；本服务目前不开 CORS，留这里是防止以后加跨域时踩坑
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = requestPath(request);
        return PUBLIC_PATHS.stream().anyMatch(pattern -> PATH_MATCHER.match(pattern, path));
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String token = extractToken(request);

        // 只把「认证」这一段包在 try 里。业务异常必须留给 GlobalExceptionHandler，
        // 否则一个 GAME_NOT_FOUND 会被这里误判成 401。
        AppUser user;
        try {
            if (token == null) {
                throw new BusinessException("UNAUTHORIZED", "请先登录");
            }
            user = authService.requireUserByToken(token);
        } catch (BusinessException | NotFoundException ex) {
            log.warn("拒绝未认证请求 {} {}：{}", request.getMethod(), requestPath(request), ex.getMessage());
            writeJson(response, HttpServletResponse.SC_UNAUTHORIZED, "UNAUTHORIZED", "登录状态已失效，请重新登录");
            return;
        }

        if (isAdminOnly(requestPath(request)) && !"SUPER_ADMIN".equals(user.getRole())) {
            log.warn("拒绝越权请求 {} {}：用户 {} 不是管理员", request.getMethod(), requestPath(request), user.getId());
            writeJson(response, HttpServletResponse.SC_FORBIDDEN, "FORBIDDEN", "需要管理员权限");
            return;
        }

        AuthContext.set(user);
        try {
            filterChain.doFilter(request, response);
        } finally {
            // 线程是池化的，必须清理，否则下一个请求会读到上一个请求的用户
            AuthContext.clear();
        }
    }

    private static boolean isAdminOnly(String path) {
        return "/api/v1/admin".equals(path) || path.startsWith(ADMIN_PREFIX);
    }

    private static String requestPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isEmpty() && uri.startsWith(contextPath)) {
            return uri.substring(contextPath.length());
        }
        return uri;
    }

    private static String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            return null;
        }
        String token = header.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    /**
     * 直接写响应体，不走 {@code @RestControllerAdvice}：过滤器在 DispatcherServlet 之前，
     * 抛出的异常到不了那里。响应结构与 {@code ApiResponse} 保持一致，前端无需区分来源。
     */
    private static void writeJson(HttpServletResponse response, int status, String code, String message)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(status);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(
                "{\"success\":false,\"code\":\"" + code + "\",\"message\":\"" + message + "\",\"data\":null}"
        );
    }
}
