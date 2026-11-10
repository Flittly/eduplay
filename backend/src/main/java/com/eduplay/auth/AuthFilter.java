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
 * 统一认证入口：除白名单外，所有 {@code /api/v1/**} 请求都必须带有效 Bearer token。
 *
 * <h2>为什么只保护 /api/v1，而不是拦截所有路径</h2>
 * 这个 jar 同时托管老师端页面（{@code index.html}、{@code /assets/**}、SPA 路由如 {@code /game/xxx}）。
 * 如果滤镜拦截全部路径，浏览器打开首页就会拿到 401，整个前端直接打不开。
 * 因此规则是「只保护接口」，静态资源与页面天然放行。
 *
 * <h2>为什么 /cloud-api 不在这里鉴权</h2>
 * 它只是转发到云端 admin-backend，而云端本身已经做了统一鉴权（同一套 AuthFilter 的云端版本）。
 * 在这一跳重复校验没有安全收益，只会让“前端某个云端调用没带 token”变成断链风险。
 * 代理不是安全边界，真正的边界在云端。
 *
 * <h2>白名单里那三条“例外”的来源</h2>
 * <ul>
 *   <li>{@code /api/v1/plugin/**} —— iframe 里加载游戏资源，浏览器不会带 Authorization，
 *       凭证是 URL 里的插件令牌，由 {@code PluginContentController} 自己校验；</li>
 *   <li>{@code /api/v1/students/import/template} —— 前端用 {@code <a href>} 直接下载，
 *       属于浏览器导航请求，同样带不了请求头；</li>
 *   <li>{@code /api/v1/store/games/{gameCode}/cover} —— {@code img} 标签加载封面。</li>
 * </ul>
 * 这三条都能被匿名访问，但都不返回任何教学数据：一个是静态资源文件、一个是空白模板、
 * 一个是商品封面。这是“为了可用性必须开的窗”，不是漏配。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
public class AuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AuthFilter.class);

    private static final String BEARER_PREFIX = "Bearer ";

    /** 受保护的接口前缀。 */
    private static final String API_PREFIX = "/api/v1/";

    /** 管理员专属前缀：除白名单外，这里要求 SUPER_ADMIN。 */
    private static final String ADMIN_PREFIX = "/api/v1/admin/";

    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    /**
     * 无需登录即可访问的接口。
     *
     * <p>登出接口刻意公开：token 过期后点退出不该报错，
     * 删除一条已知的 token 本身也不需要证明自己还有效。
     */
    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/v1/health",
            "/api/v1/health/**",
            "/api/v1/auth/local/login",
            "/api/v1/auth/local/register",
            "/api/v1/auth/logout",
            "/api/v1/admin/login",
            "/api/v1/admin/logout",
            "/api/v1/students/import/template",
            "/api/v1/store/games/*/cover",
            "/api/v1/plugin/**"
    );

    private final AuthService authService;

    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // 预检请求不带业务凭证，直接放行；本服务不开 CORS，留这里是防止以后加跨域时踩坑
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String path = requestPath(request);

        // 页面、静态资源、/cloud-api 全部不归这里管
        boolean isApiRequest = "/api/v1".equals(path) || path.startsWith(API_PREFIX);
        if (!isApiRequest) {
            return true;
        }

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
