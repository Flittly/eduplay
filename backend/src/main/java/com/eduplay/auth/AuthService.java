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

    /**
     * 用户不存在时也要跑一次的对照哈希。
     *
     * <p>原先「查不到用户就立刻抛异常、查到才做 BCrypt」：BCrypt 一次约 60~80 ms，
     * 两条分支的响应时间差了一个数量级，攻击者据此就能枚举出哪些用户名存在
     * （进而只对存在的账号撞库）。这里在启动时算一次固定口令的哈希，
     * 走「查不到」分支时拿它做一次等价耗时的比对。
     */
    private final String timingDummyHash;

    /**
     * BCrypt 只使用密码的前 **72 字节**，超出部分被静默丢弃。
     *
     * <p>`@Size(max = 64)` 限制的是**字符**数：64 个汉字 = 192 字节，
     * 于是「前 72 字节相同的两串密码」都能登录成功。这里按 UTF-8 字节数卡死，
     * 与 BCrypt 的实际输入口径对齐。
     */
    private static final int MAX_PASSWORD_BYTES = 72;

    public AuthService(
            AppUserRepository userRepository,
            LocalSessionRepository sessionRepository,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.passwordEncoder = passwordEncoder;
        this.timingDummyHash = passwordEncoder.encode("timing-equalizer-not-a-real-password");
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
        requirePasswordFitsBcrypt(request.password());

        AppUser user = new AppUser();
        user.setUsername(username);
        user.setNickname(nickname);
        user.setUserType("LOCAL");
        user.setRole(role);
        user.setStatus("ACTIVE");
        // 与其他入口（Excel 导入、手工新增）保持同一口径：
        // 学生导入是按 trim 后的班级/学号判重的，注册这边不 trim 就会造出
        // 「"高一1班" 与 "高一1班 "」两个视觉相同、判重不同的班级。
        user.setStudentNo(normalizeNullable(request.studentNo()));
        user.setClassName(normalizeNullable(request.className()));
        applyProfile(user, request.nickname(), request.phone(), request.email(),
                request.gender(), request.birthday());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        userRepository.save(user);

        return createSession(user);
    }

    @Transactional
    public UserResponse updateProfile(UpdateProfileRequest request) {
        // ⚠ 必须按 id 重新读一次，不能直接改 AuthContext 里的那个实例：
        // 它来自过滤器里那次独立事务，事务一结束就 detach 了。对 detached 实体调
        // save() 走的是 merge —— 把内存里**所有字段**写回数据库，包括那些本次没动、
        // 但已经被别人改过的字段。典型现场：管理员刚把这个教师设成 DISABLED，
        // 教师自己改个昵称，status 就被内存里的旧值 ACTIVE 覆盖回去了。
        AppUser current = AuthContext.requireUser();
        AppUser user = userRepository.findById(current.getId())
                .orElseThrow(() -> new NotFoundException("用户不存在"));
        applyProfile(user, request.nickname(), request.phone(), request.email(),
                request.gender(), request.birthday());
        // 受管实体，脏检查会在提交时自动落库，无需再 save()
        return UserResponse.from(user);
    }

    private void requirePasswordFitsBcrypt(String password) {
        if (password != null
                && password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new BusinessException(
                    "PASSWORD_TOO_LONG",
                    "密码过长（按 UTF-8 计算不能超过 " + MAX_PASSWORD_BYTES + " 字节，约 24 个汉字）"
            );
        }
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
                .orElse(null);

        // 用户不存在时也走一次同代价的 BCrypt（见 timingDummyHash），
        // 让「用户名不存在」和「密码错误」在耗时上不可区分。
        boolean matches = passwordEncoder.matches(
                request.password(),
                user == null || user.getPasswordHash() == null
                        ? timingDummyHash
                        : user.getPasswordHash()
        );
        if (user == null || user.getPasswordHash() == null || !matches) {
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
                .orElse(null);

        boolean matches = passwordEncoder.matches(
                request.password(),
                user == null || user.getPasswordHash() == null
                        ? timingDummyHash
                        : user.getPasswordHash()
        );
        if (user == null || user.getPasswordHash() == null || !matches) {
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
    public UserResponse getCurrentUser() {
        return UserResponse.from(AuthContext.requireUser());
    }

    /**
     * 按 token 查当前用户。这是认证的唯一实现，只被 {@link AuthFilter} 调用。
     *
     * <p>保留 public 是为了让过滤器（同包）能调到；业务代码不应该直接用它，
     * 需要当前用户请用 {@link AuthContext}。
     */
    @Transactional(readOnly = true)
    public AppUser requireUserByToken(String token) {
        if (token == null || token.isBlank()) {
            throw new BusinessException("UNAUTHORIZED", "请先登录");
        }
        // 一条 SQL 同时校验会话有效期并取出用户（原先分两次查：session 一次、user 一次）。
        // 插件资源的每个文件请求都要走这里，一次开游戏 80~160 次，省掉一半查询。
        AppUser user = sessionRepository.findUserByToken(token, Instant.now())
                .orElseThrow(() -> new BusinessException("UNAUTHORIZED", "登录状态已失效，请重新登录"));

        // 会话有效期之外还必须校验账号状态：token 改为永久有效后，
        // 少了这一句，被禁用的账号就永远踢不出去了。
        if ("DISABLED".equals(user.getStatus())) {
            throw new BusinessException("ACCOUNT_DISABLED", "账号已被禁用");
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
