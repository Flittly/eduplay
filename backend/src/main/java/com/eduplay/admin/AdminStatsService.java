package com.eduplay.admin;

import com.eduplay.auth.AuthService;
import com.eduplay.game.ActivationCodeRepository;
import com.eduplay.game.GameProductRepository;
import com.eduplay.user.AppUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminStatsService {

    private final AuthService authService;
    private final AppUserRepository userRepository;
    private final GameProductRepository gameProductRepository;
    private final ActivationCodeRepository activationCodeRepository;

    public AdminStatsService(
            AuthService authService,
            AppUserRepository userRepository,
            GameProductRepository gameProductRepository,
            ActivationCodeRepository activationCodeRepository
    ) {
        this.authService = authService;
        this.userRepository = userRepository;
        this.gameProductRepository = gameProductRepository;
        this.activationCodeRepository = activationCodeRepository;
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(String authorization) {
        authService.requireAdmin(authorization);
        long totalCodes = activationCodeRepository.count();
        long usedCodes = activationCodeRepository.countByStatus("USED");
        return new StatsResponse(
                userRepository.countByRole("TEACHER"),
                userRepository.countByRoleAndStatus("TEACHER", "ACTIVE"),
                userRepository.countByRoleAndStatus("TEACHER", "DISABLED"),
                0,
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
