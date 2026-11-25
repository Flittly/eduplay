package com.eduplay.admin;

import com.eduplay.auth.AuthContext;

import com.eduplay.game.ActivationCodeRepository;
import com.eduplay.game.GameProductRepository;
import com.eduplay.student.StudentRepository;
import com.eduplay.user.AppUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminStatsService {

    private final AppUserRepository userRepository;
    private final GameProductRepository gameProductRepository;
    private final ActivationCodeRepository activationCodeRepository;
    private final StudentRepository studentRepository;

    public AdminStatsService(
            AppUserRepository userRepository,
            GameProductRepository gameProductRepository,
            ActivationCodeRepository activationCodeRepository,
            StudentRepository studentRepository
    ) {
        this.userRepository = userRepository;
        this.gameProductRepository = gameProductRepository;
        this.activationCodeRepository = activationCodeRepository;
        this.studentRepository = studentRepository;
    }

    @Transactional(readOnly = true)
    public StatsResponse stats() {
        AuthContext.requireAdmin();
        long totalCodes = activationCodeRepository.count();
        long usedCodes = activationCodeRepository.countByStatus("USED");
        return new StatsResponse(
                userRepository.countByRole("TEACHER"),
                userRepository.countByRoleAndStatus("TEACHER", "ACTIVE"),
                userRepository.countByRoleAndStatus("TEACHER", "DISABLED"),
                // 原先硬编码 0：本地管理端首页的「学生总数」永远是 0。
                studentRepository.count(),
                gameProductRepository.count(),
                totalCodes,
                usedCodes,
                totalCodes - usedCodes
        );
    }

    public record StatsResponse(
            long teacherTotal,
            long teacherActive,
            long teacherDisabled,
            long studentTotal,
            long gameTotal,
            long codeTotal,
            long codeUsed,
            long codeUnused
    ) {
    }
}
