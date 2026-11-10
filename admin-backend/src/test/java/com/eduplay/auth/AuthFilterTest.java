package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 鉴权入口的边界测试。
 *
 * <p>这些用例的目的不是覆盖率，而是钉住三件容易在重构中退化的事：
 * 公开路径别被误拦、默认行为必须是拒绝、业务异常别被误判成 401。
 */
class AuthFilterTest {

    private final AuthService authService = mock(AuthService.class);
    private final AuthFilter filter = new AuthFilter(authService);

    @AfterEach
    void tearDown() {
        AuthContext.clear();
    }

    private MockHttpServletResponse run(String method, String uri, String token) throws Exception {
        return run(method, uri, token, new MockFilterChain());
    }

    private MockHttpServletResponse run(String method, String uri, String token, FilterChain chain)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        if (token != null) {
            request.addHeader("Authorization", "Bearer " + token);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        return response;
    }

    private static AppUser user(String role) {
        AppUser user = new AppUser();
        user.setId(1L);
        user.setUsername("tester");
        user.setRole(role);
        user.setStatus("ACTIVE");
        return user;
    }

    @Test
    void 未带令牌访问业务接口返回401() throws Exception {
        MockHttpServletResponse response = run("GET", "/api/v1/store/games", null);

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("\"code\":\"UNAUTHORIZED\"");
    }

    @Test
    void 令牌失效返回401而不是500() throws Exception {
        when(authService.requireUserByToken("expired"))
                .thenThrow(new BusinessException("UNAUTHORIZED", "登录状态已失效，请重新登录"));

        MockHttpServletResponse response = run("GET", "/api/v1/store/games", "expired");

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("\"success\":false");
    }

    @Test
    void 教师访问管理接口返回403() throws Exception {
        when(authService.requireUserByToken("teacher-token")).thenReturn(user("TEACHER"));

        MockHttpServletResponse response = run("GET", "/api/v1/admin/games", "teacher-token");

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("\"code\":\"FORBIDDEN\"");
    }

    @Test
    void 管理员访问管理接口放行且上下文可读() throws Exception {
        when(authService.requireUserByToken("admin-token")).thenReturn(user("SUPER_ADMIN"));

        AtomicReference<AppUser> seen = new AtomicReference<>();
        FilterChain chain = (request, response) -> seen.set(AuthContext.requireUser());

        MockHttpServletResponse response = run("GET", "/api/v1/admin/games", "admin-token", chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(seen.get()).isNotNull();
        assertThat(seen.get().getRole()).isEqualTo("SUPER_ADMIN");
    }

    @Test
    void 请求结束后上下文被清理不残留到下一个请求() throws Exception {
        when(authService.requireUserByToken("admin-token")).thenReturn(user("SUPER_ADMIN"));

        run("GET", "/api/v1/admin/games", "admin-token");

        assertThatThrownBy(AuthContext::requireUser).isInstanceOf(BusinessException.class);
    }

    @Test
    void 健康检查与封面图无需登录() throws Exception {
        assertThat(run("GET", "/api/v1/health", null).getStatus()).isEqualTo(200);
        assertThat(run("GET", "/api/v1/store/games/landform_quiz/cover", null).getStatus()).isEqualTo(200);
    }

    @Test
    void 登录与登出无需登录() throws Exception {
        assertThat(run("POST", "/api/v1/auth/local/login", null).getStatus()).isEqualTo(200);
        assertThat(run("POST", "/api/v1/admin/login", null).getStatus()).isEqualTo(200);
        assertThat(run("POST", "/api/v1/auth/logout", null).getStatus()).isEqualTo(200);
    }

    @Test
    void 预检请求直接放行() throws Exception {
        assertThat(run("OPTIONS", "/api/v1/admin/games", null).getStatus()).isEqualTo(200);
    }

    /**
     * 回归点：业务异常必须原样抛给 GlobalExceptionHandler。
     * 早期写法把整段链包在 try 里，会让「游戏不存在」变成「登录失效」。
     */
    @Test
    void 下游业务异常不被误判成401() throws Exception {
        when(authService.requireUserByToken("admin-token")).thenReturn(user("SUPER_ADMIN"));

        FilterChain chain = (request, response) -> {
            throw new BusinessException("GAME_NOT_FOUND", "游戏不存在");
        };

        assertThatThrownBy(() -> run("GET", "/api/v1/admin/games", "admin-token", chain))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("游戏不存在");
    }
}
