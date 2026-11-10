package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;

/**
 * 当前请求的登录用户。
 *
 * <p>由 {@link AuthFilter} 在请求进入时写入、请求结束时清理，业务层只读。
 * 这样做的目的是让“认证”只有一个入口：控制器不再声明 {@code Authorization} 参数，
 * 服务层也不再需要一层层往下传请求头 —— 只要请求进得来，这里就一定有用户。
 *
 * <p>写入方法刻意是包级可见的（没有 public）：只有同一个包里的 {@link AuthFilter}
 * 能改，业务代码无法伪造身份。
 */
public final class AuthContext {

    private static final ThreadLocal<AppUser> CURRENT_USER = new ThreadLocal<>();

    private AuthContext() {
    }

    static void set(AppUser user) {
        CURRENT_USER.set(user);
    }

    static void clear() {
        CURRENT_USER.remove();
    }

    /**
     * 取当前用户。
     *
     * <p>正常情况下过滤器已经拦过未登录请求，这里的异常只是兜底：
     * 一旦有人绕过过滤器（比如在过滤器之前调用），也必须是 401 而不是空指针。
     */
    public static AppUser requireUser() {
        AppUser user = CURRENT_USER.get();
        if (user == null) {
            throw new BusinessException("UNAUTHORIZED", "请先登录");
        }
        return user;
    }

    /** 管理员身份断言。过滤器的路径规则是第一道锁，这里是第二道（不查库，仅字段判断）。 */
    public static AppUser requireAdmin() {
        AppUser user = requireUser();
        if (!"SUPER_ADMIN".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "需要管理员权限");
        }
        return user;
    }

    /** 教师身份断言：商城、成绩、班级这些教学数据只对教师账号开放。 */
    public static AppUser requireTeacher() {
        AppUser user = requireUser();
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以访问教学数据");
        }
        return user;
    }
}
