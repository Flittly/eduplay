package com.eduplay.admin;

import com.eduplay.auth.AuthContext;
import com.eduplay.auth.LocalSessionRepository;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.student.StudentRepository;
import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

@Service
public class AdminTeacherService {

    /** 与 AuthService 同口径：BCrypt 只用前 72 字节，超出部分被静默丢弃。 */
    private static final int MAX_PASSWORD_BYTES = 72;

    private final AppUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final LocalSessionRepository sessionRepository;
    private final StudentRepository studentRepository;

    public AdminTeacherService(
            AppUserRepository userRepository,
            PasswordEncoder passwordEncoder,
            LocalSessionRepository sessionRepository,
            StudentRepository studentRepository
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.sessionRepository = sessionRepository;
        this.studentRepository = studentRepository;
    }

    @Transactional(readOnly = true)
    public List<TeacherResponse> listTeachers(String keyword) {
        AuthContext.requireAdmin();
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);

        return userRepository.findByRoleOrderByCreatedAtDesc("TEACHER").stream()
                .filter(teacher -> normalized.isBlank()
                        || teacher.getNickname() != null
                        && teacher.getNickname().toLowerCase(Locale.ROOT).contains(normalized)
                        || teacher.getUsername().toLowerCase(Locale.ROOT).contains(normalized))
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public TeacherResponse updateStatus(Long teacherId, String status) {
        AuthContext.requireAdmin();
        AppUser teacher = getTeacher(teacherId);
        String normalized = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
        if (!"ACTIVE".equals(normalized) && !"DISABLED".equals(normalized)) {
            throw new BusinessException("INVALID_STATUS", "状态只能是 ACTIVE 或 DISABLED");
        }
        teacher.setStatus(normalized);
        if ("DISABLED".equals(normalized)) {
            // 禁用即下线：token 是永久的，留着不删，账号一旦重新启用，
            // 那些旧 token 会立刻一起「复活」。
            sessionRepository.deleteByUserId(teacher.getId());
        }
        userRepository.save(teacher);
        return toResponse(teacher);
    }

    @Transactional
    public TeacherResponse resetPassword(
            Long teacherId,
            String newPassword
    ) {
        AuthContext.requireAdmin();
        AppUser teacher = getTeacher(teacherId);
        if (newPassword == null || newPassword.length() < 6) {
            throw new BusinessException("INVALID_PASSWORD", "新密码至少6位");
        }
        // ⚠ 按 UTF-8 字节数卡 72：`@Size(max = 64)` 限的是字符，64 个汉字 = 192 字节，
        // 超出 72 字节的部分 BCrypt 直接丢掉 —— 两个「前 72 字节相同」的密码都能登录，
        // 管理员以为自己设了一个新密码，实际上等于没改。
        if (newPassword.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new BusinessException(
                    "PASSWORD_TOO_LONG",
                    "新密码过长（按 UTF-8 计算不能超过 " + MAX_PASSWORD_BYTES + " 字节，约 24 个汉字）"
            );
        }
        teacher.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(teacher);
        // 改密必须同时清掉该用户的全部会话，否则旧 token 依旧有效，
        // 「重置密码」在安全语义上等于没发生。
        sessionRepository.deleteByUserId(teacher.getId());
        return toResponse(teacher);
    }

    private AppUser getTeacher(Long teacherId) {
        AppUser user = userRepository.findById(teacherId)
                .orElseThrow(() -> new NotFoundException("教师不存在"));
        if (!"TEACHER".equals(user.getRole())) {
            throw new NotFoundException("教师不存在");
        }
        return user;
    }

    private TeacherResponse toResponse(AppUser teacher) {
        return new TeacherResponse(
                teacher.getId(),
                teacher.getUsername(),
                teacher.getNickname(),
                teacher.getStatus(),
                studentRepository.countByTeacherId(teacher.getId()),
                teacher.getCreatedAt() == null ? null : teacher.getCreatedAt().toString()
        );
    }

    public record TeacherResponse(
            Long id,
            String username,
            String nickname,
            String status,
            long studentCount,
            String createdAt
    ) {
    }
}
