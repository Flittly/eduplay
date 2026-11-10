package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 统一认证入口的回归测试。
 *
 * <p>这组用例保护的是“默认拒绝”这个最关键的性质：新增接口时不需要任何配置就自动受保护，
 * 忘记配置的后果是“访问不了”，而不是“裸奔”。
 */
class AuthFilterTest {

    private final AuthService authService = mock(AuthService.class);
    private final AuthFilter filter = new AuthFilter(authService);

    private static AppUser user(String role) {
        AppUser user = new AppUser();
        user.setId(1L);
        user.setUsername("tester");
        user.setRole(role);
        user.setStatus("ACTIVE");
        return user;
    }

    private static MockHttpServletRequest request(String method, String path) {
        return new MockHttpServletRequest(method, path);
    }

    /** 走一次过滤器，返回“请求是否被放行到了下游”。 */
    private boolean pass(MockHttpServletRequest request, MockHttpServletResponse response) throws Exception {
        AtomicBoolean reached = new AtomicBoolean(false);
        FilterChain chain = (req, res) -> reached.set(true);
        filter.doFilter(request, response, chain);
        return reached.get();
    }

    @Test
    void 未带令牌访问业务接口返回401() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        boolean reached = pass(request("GET", "/api/v1/students"), response);

        assertThat(reached).isFalse();
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("UNAUTHORIZED");
    }

    @Test
    void 无效令牌返回401() throws Exception {
        when(authService.requireUserByToken(anyString()))
                .thenThrow(new BusinessException("UNAUTHORIZED", "登录状态已失效"));
        MockHttpServletRequest request = request("GET", "/api/v1/students");
        request.addHeader("Authorization", "Bearer broken");
        MockHttpServletResponse response = new MockHttpServletResponse();

        boolean reached = pass(request, response);

        assertThat(reached).isFalse();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void 教师访问管理接口返回403() throws Exception {
        when(authService.requireUserByToken("teacher-token")).thenReturn(user("TEACHER"));
        MockHttpServletRequest request = request("GET", "/api/v1/admin/games");
        request.addHeader("Authorization", "Bearer teacher-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        boolean reached = pass(request, response);

        assertThat(reached).isFalse();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("FORBIDDEN");
    }

    @Test
    void 管理员访问管理接口放行() throws Exception {
        when(authService.requireUserByToken("admin-token")).thenReturn(user("SUPER_ADMIN"));
        MockHttpServletRequest request = request("GET", "/api/v1/admin/games");
        request.addHeader("Authorization", "Bearer admin-token");

        assertThat(pass(request, new MockHttpServletResponse())).isTrue();
    }

    @Test
    void 教师访问业务接口放行() throws Exception {
        when(authService.requireUserByToken("teacher-token")).thenReturn(user("TEACHER"));
        MockHttpServletRequest request = request("GET", "/api/v1/students");
        request.addHeader("Authorization", "Bearer teacher-token");

        assertThat(pass(request, new MockHttpServletResponse())).isTrue();
    }

    @Test
    void 健康检查无需令牌() throws Exception {
        assertThat(pass(request("GET", "/api/v1/health"), new MockHttpServletResponse())).isTrue();
    }

    @Test
    void 前端页面与静态资源无需令牌() throws Exception {
        // 这个 jar 同时托管老师端页面，如果拦截了首页，整个前端就打不开
        assertThat(pass(request("GET", "/"), new MockHttpServletResponse())).isTrue();
        assertThat(pass(request("GET", "/assets/index-abc123.js"), new MockHttpServletResponse())).isTrue();
        assertThat(pass(request("GET", "/game/landform_quiz"), new MockHttpServletResponse())).isTrue();
    }

    @Test
    void iframe插件资源无需令牌() throws Exception {
        // 浏览器加载 iframe 不会带 Authorization，凭证是 URL 里的插件令牌
        assertThat(pass(
                request("GET", "/api/v1/plugin/abc123/landform_quiz/1.3.0/index.html"),
                new MockHttpServletResponse()
        )).isTrue();
    }

    @Test
    void 导入模板下载无需令牌() throws Exception {
        // 前端用 <a href> 直接下载，浏览器导航请求带不了请求头
        assertThat(pass(
                request("GET", "/api/v1/students/import/template"),
                new MockHttpServletResponse()
        )).isTrue();
    }

    @Test
    void 云端代理不在这里鉴权() throws Exception {
        // /cloud-api 转发到已统一鉴权的云端，本地重复校验只会带来断链风险
        assertThat(pass(
                request("GET", "/cloud-api/api/v1/store/games"),
                new MockHttpServletResponse()
        )).isTrue();
    }

    @Test
    void 登出接口无需有效令牌() throws Exception {
        // token 过期后点退出不该报错
        MockHttpServletRequest request = request("POST", "/api/v1/auth/logout");
        request.addHeader("Authorization", "Bearer expired");

        assertThat(pass(request, new MockHttpServletResponse())).isTrue();
    }

    @Test
    void 下游业务异常不被误判成401() throws Exception {
        // 只有「认证」那一段在 try 里，业务异常必须原样抛给全局异常处理器
        when(authService.requireUserByToken("teacher-token")).thenReturn(user("TEACHER"));
        MockHttpServletRequest request = request("GET", "/api/v1/students");
        request.addHeader("Authorization", "Bearer teacher-token");

        AtomicBoolean thrown = new AtomicBoolean(false);
        FilterChain chain = (req, res) -> {
            throw new BusinessException("GAME_NOT_FOUND", "游戏不存在");
        };

        try {
            filter.doFilter(request, new MockHttpServletResponse(), chain);
        } catch (BusinessException ex) {
            thrown.set(true);
        }

        assertThat(thrown).isTrue();
    }

    @Test
    void 请求结束后清理线程上下文() throws Exception {
        // Tomcat 线程是复用的，不清理会让下一个请求读到上一个请求的用户
        when(authService.requireUserByToken("teacher-token")).thenReturn(user("TEACHER"));
        MockHttpServletRequest request = request("GET", "/api/v1/students");
        request.addHeader("Authorization", "Bearer teacher-token");

        pass(request, new MockHttpServletResponse());

        AtomicBoolean hasUser = new AtomicBoolean(true);
        try {
            AuthContext.requireUser();
        } catch (BusinessException ex) {
            hasUser.set(false);
        }
        assertThat(hasUser).isFalse();
    }
}
