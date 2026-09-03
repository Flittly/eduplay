package com.eduplay.auth;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import com.eduplay.user.UserResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {

    private static final String TOKEN_PREFIX = "Bearer ";

    private final AppUserRepository userRepository;
    private final LocalSessionRepository sessionRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(
            AppUserRepository userRepository,
            LocalSessionRepository sessionRepository,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public LoginResult registerLocal(RegisterLocalRequest request) {
        String username = request.username().trim();
        String nickname = request.nickname() == null || request.nickname().isBlank()
                ? username
                : request.nickname().trim();
        String role = normalizeRole(request.role());

        if (userRepository.existsByUsername(username)) {
            throw new BusinessException("USERNAME_EXISTS", "用户名已存在");
        }

        AppUser user = new AppUser();
        user.setUsername(username);
        user.setNickname(nickname);
        user.setUserType("LOCAL");
        user.setRole(role);
        user.setStudentNo(request.studentNo());
        user.setClassName(request.className());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        userRepository.save(user);

        return createSession(user);
    }

    @Transactional
    public LoginResult loginLocal(LoginLocalRequest request) {
        AppUser user = userRepository.findByUsername(request.username().trim())
                .filter(item -> "LOCAL".equals(item.getUserType()))
                .orElseThrow(() -> new BusinessException("BAD_CREDENTIALS", "用户名或密码错误"));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new BusinessException("BAD_CREDENTIALS", "用户名或密码错误");
        }

        return createSession(user);
    }

    @Transactional
    public void logout(String authorizationHeader) {
        String token = extractToken(authorizationHeader);
        if (token != null) {
            sessionRepository.deleteByToken(token);
        }
    }

    @Transactional(readOnly = true)
    public UserResponse getCurrentUser(String authorizationHeader) {
        AppUser user = requireUser(authorizationHeader);
        return UserResponse.from(user);
    }

    @Transactional(readOnly = true)
    public AppUser requireUser(String authorizationHeader) {
        String token = extractToken(authorizationHeader);
        if (token == null) {
            throw new BusinessException("UNAUTHORIZED", "请先登录");
        }

        LocalSession session = sessionRepository.findByToken(token)
                .filter(item -> item.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> new BusinessException("UNAUTHORIZED", "登录状态已失效，请重新登录"));

        return userRepository.findById(session.getUserId())
                .orElseThrow(() -> new NotFoundException("用户不存在"));
    }

    private LoginResult createSession(AppUser user) {
        LocalSession session = new LocalSession();
        session.setUserId(user.getId());
        session.setToken(UUID.randomUUID().toString());
        session.setExpiresAt(Instant.now().plus(30, ChronoUnit.DAYS));
        session.setCreatedAt(Instant.now());
        sessionRepository.save(session);
        return new LoginResult(session.getToken(), UserResponse.from(user));
    }

    private String extractToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith(TOKEN_PREFIX)) {
            return null;
        }
        return authorizationHeader.substring(TOKEN_PREFIX.length()).trim();
    }

    private String normalizeRole(String role) {
        if (role == null || role.isBlank()) {
            return "TEACHER";
        }
        String normalized = role.trim().toUpperCase(Locale.ROOT);
        if (!"TEACHER".equals(normalized)) {
            throw new BusinessException("INVALID_ROLE", "当前平台只允许注册教师账号");
        }
        return normalized;
    }

    public record RegisterLocalRequest(
            String username,
            String password,
            String nickname,
            String role,
            String studentNo,
            String className
    ) {
    }

    public record LoginLocalRequest(
            String username,
            String password
    ) {
    }

    public record LoginResult(
            String token,
            UserResponse user
    ) {
    }
}
