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
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class AuthService {

    private static final String TOKEN_PREFIX = "Bearer ";

    /**
     * 永久登录会话的过期时间哨兵。
     *
     * <p>平台面向单个教师、常驻本机使用，登录一次后不应再被要求重新登录，
     * 因此会话改为永久有效：{@code requireUserByToken} 的过期判断保留不动，
     * 该时间恒在未来即等价于"永不过期"；将来若要恢复过期策略，只需改回
     * {@code Instant.now().plus(...)} 一处。
     *
     * <p>取 {@code 9999-01-01} 而非 {@code 9999-12-31}：{@code expires_at} 是
     * 不带时区的 {@code timestamp}，写入时会按 JVM 默认时区换算；东八区下
     * {@code 9999-12-31T23:59:59Z} 会进位成 10000 年而溢出，留足余量更安全。
     */
    private static final Instant PERMANENT_SESSION_EXPIRES_AT =
            Instant.parse("9999-01-01T00:00:00Z");

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
        user.setStatus("ACTIVE");
        user.setStudentNo(request.studentNo());
        user.setClassName(request.className());
        applyProfile(user, request.nickname(), request.phone(), request.email(),
                request.gender(), request.birthday());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        userRepository.save(user);

        return createSession(user);
    }

    @Transactional
    public UserResponse updateProfile(String authorizationHeader, UpdateProfileRequest request) {
        AppUser user = requireUser(authorizationHeader);
        applyProfile(user, request.nickname(), request.phone(), request.email(),
                request.gender(), request.birthday());
        userRepository.save(user);
        return UserResponse.from(user);
    }

    private void applyProfile(
            AppUser user,
            String nickname,
            String phone,
            String email,
            String gender,
            String birthday
    ) {
        if (nickname != null) {
            String trimmed = nickname.trim();
            user.setNickname(trimmed.isEmpty() ? user.getUsername() : trimmed);
        }
        user.setPhone(normalizeNullable(phone));
        user.setEmail(normalizeNullable(email));
        if (gender == null || gender.isBlank()) {
            user.setGender(null);
        } else {
            String normalized = gender.trim().toUpperCase(Locale.ROOT);
            if (!Set.of("MALE", "FEMALE", "OTHER").contains(normalized)) {
                throw new BusinessException("INVALID_GENDER", "性别取值不合法");
            }
            user.setGender(normalized);
        }
        String normalizedBirthday = normalizeNullable(birthday);
        if (normalizedBirthday == null) {
            user.setBirthday(null);
        } else {
            try {
                user.setBirthday(LocalDate.parse(normalizedBirthday));
            } catch (DateTimeParseException ex) {
                throw new BusinessException("INVALID_BIRTHDAY", "生日格式应为 yyyy-MM-dd");
            }
        }
    }

    private String normalizeNullable(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
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
        if ("DISABLED".equals(user.getStatus())) {
            throw new BusinessException("ACCOUNT_DISABLED", "账号已被禁用");
        }

        return createSession(user);
    }

    @Transactional
    public LoginResult loginAdmin(LoginLocalRequest request) {
        AppUser user = userRepository.findByUsername(request.username().trim())
                .filter(item -> "ADMIN".equals(item.getUserType())
                        && "SUPER_ADMIN".equals(item.getRole()))
                .orElseThrow(() -> new BusinessException("BAD_CREDENTIALS", "用户名或密码错误"));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new BusinessException("BAD_CREDENTIALS", "用户名或密码错误");
        }
        if ("DISABLED".equals(user.getStatus())) {
            throw new BusinessException("ACCOUNT_DISABLED", "管理员账号已被禁用");
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
        return requireUserByToken(token);
    }

    @Transactional(readOnly = true)
    public AppUser requireUserByToken(String token) {
        if (token == null || token.isBlank()) {
            throw new BusinessException("UNAUTHORIZED", "请先登录");
        }
        LocalSession session = sessionRepository.findByToken(token)
                .filter(item -> item.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> new BusinessException("UNAUTHORIZED", "登录状态已失效，请重新登录"));

        AppUser user = userRepository.findById(session.getUserId())
                .orElseThrow(() -> new NotFoundException("用户不存在"));

        // 会话有效期之外还必须校验账号状态：token 改为永久有效后，
        // 少了这一句，被禁用的账号就永远踢不出去了。
        if ("DISABLED".equals(user.getStatus())) {
            throw new BusinessException("ACCOUNT_DISABLED", "账号已被禁用");
        }
        return user;
    }

    @Transactional(readOnly = true)
    public AppUser requireAdmin(String authorizationHeader) {
        AppUser user = requireUser(authorizationHeader);
        if (!"SUPER_ADMIN".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "需要管理员权限");
        }
        return user;
    }

    private LoginResult createSession(AppUser user) {
        LocalSession session = new LocalSession();
        session.setUserId(user.getId());
        session.setToken(UUID.randomUUID().toString());
        session.setExpiresAt(PERMANENT_SESSION_EXPIRES_AT);
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
            String className,
            String phone,
            String email,
            String gender,
            String birthday
    ) {
    }

    public record UpdateProfileRequest(
            String nickname,
            String phone,
            String email,
            String gender,
            String birthday
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
