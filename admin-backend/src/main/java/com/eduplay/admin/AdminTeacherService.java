package com.eduplay.admin;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

@Service
public class AdminTeacherService {

    private final AuthService authService;
    private final AppUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AdminTeacherService(
            AuthService authService,
            AppUserRepository userRepository,
            PasswordEncoder passwordEncoder
    ) {
        this.authService = authService;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional(readOnly = true)
    public List<TeacherResponse> listTeachers(String authorization, String keyword) {
        authService.requireAdmin(authorization);
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
    public TeacherResponse updateStatus(String authorization, Long teacherId, String status) {
        authService.requireAdmin(authorization);
        AppUser teacher = getTeacher(teacherId);
        String normalized = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
        if (!"ACTIVE".equals(normalized) && !"DISABLED".equals(normalized)) {
            throw new BusinessException("INVALID_STATUS", "状态只能是 ACTIVE 或 DISABLED");
        }
        teacher.setStatus(normalized);
        userRepository.save(teacher);
        return toResponse(teacher);
    }

    @Transactional
    public TeacherResponse resetPassword(
            String authorization,
            Long teacherId,
            String newPassword
    ) {
        authService.requireAdmin(authorization);
        AppUser teacher = getTeacher(teacherId);
        if (newPassword == null || newPassword.length() < 6) {
            throw new BusinessException("INVALID_PASSWORD", "新密码至少6位");
        }
        teacher.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(teacher);
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
                0,
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
