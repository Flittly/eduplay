package com.eduplay.auth;

import com.eduplay.user.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface LocalSessionRepository extends JpaRepository<LocalSession, Long> {

    Optional<LocalSession> findByToken(String token);

    void deleteByToken(String token);

    /**
     * 让某个用户的**全部**会话立即失效。
     *
     * <p>改密、重置密码、禁用账号时必须调用：token 是永久有效的，只改密码不删会话，
     * 旧 token 依旧能一直用到天荒地老 —— 管理端的「重置密码」等于没生效。
     */
    void deleteByUserId(Long userId);

    /**
     * 一次查询同时校验 token 并取出用户（会话 + 用户两张表）。
     *
     * <p>插件资源是「每个文件一次请求」的热路径，一次开游戏 80~160 个请求，
     * 每个都查两遍库纯属浪费。过期判断放在 SQL 里，语义与
     * {@link AuthService#requireUserByToken} 保持一致。
     */
    @Query("select u from LocalSession s, AppUser u"
            + " where u.id = s.userId and s.token = :token and s.expiresAt > :now")
    Optional<AppUser> findUserByToken(@Param("token") String token, @Param("now") Instant now);
}

