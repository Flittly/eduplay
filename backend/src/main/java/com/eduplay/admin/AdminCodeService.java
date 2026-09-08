package com.eduplay.admin;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.game.ActivationCode;
import com.eduplay.game.ActivationCodeRepository;
import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

@Service
public class AdminCodeService {

    private static final String ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final AuthService authService;
    private final ActivationCodeRepository activationCodeRepository;
    private final AppUserRepository userRepository;
    private final SecureRandom secureRandom = new SecureRandom();

    public AdminCodeService(
            AuthService authService,
            ActivationCodeRepository activationCodeRepository,
            AppUserRepository userRepository
    ) {
        this.authService = authService;
        this.activationCodeRepository = activationCodeRepository;
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public List<CodeResponse> listCodes(String authorization) {
        authService.requireAdmin(authorization);
        return activationCodeRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public List<CodeResponse> generateCodes(
            String authorization,
            String gameCode,
            int count
    ) {
        authService.requireAdmin(authorization);
        if (gameCode == null || gameCode.isBlank()) {
            throw new BusinessException("INVALID_GAME", "游戏代码不能为空");
        }
        if (count < 1 || count > 500) {
            throw new BusinessException("INVALID_COUNT", "单次生成数量应在1到500之间");
        }

        List<CodeResponse> created = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            ActivationCode code = new ActivationCode();
            code.setGameCode(gameCode.trim());
            code.setCode(generateCode(gameCode.trim()));
            code.setStatus("UNUSED");
            activationCodeRepository.save(code);
            created.add(toResponse(code));
        }
        return created;
    }

    private String generateCode(String gameCode) {
        String prefix = gameCode.contains("_")
                ? gameCode.substring(0, Math.min(gameCode.indexOf('_'), 6)).toUpperCase()
                : gameCode.substring(0, Math.min(gameCode.length(), 6)).toUpperCase();
        return prefix + "-" + randomPart() + "-" + randomPart();
    }

    private String randomPart() {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < 4; i++) {
            builder.append(ALPHABET.charAt(secureRandom.nextInt(ALPHABET.length())));
        }
        return builder.toString();
    }

    private CodeResponse toResponse(ActivationCode code) {
        String usedBy = null;
        if (code.getUsedByUserId() != null) {
            usedBy = userRepository.findById(code.getUsedByUserId())
                    .map(AppUser::getUsername)
                    .orElse(null);
        }
        return new CodeResponse(
                code.getId(),
                code.getCode(),
                code.getGameCode(),
                code.getStatus(),
                usedBy,
                code.getUsedAt() == null ? null : code.getUsedAt().toString(),
                code.getCreatedAt() == null ? null : code.getCreatedAt().toString()
        );
    }

    public record CodeResponse(
            Long id,
            String code,
            String gameCode,
            String status,
            String usedBy,
            String usedAt,
            String createdAt
    ) {
    }
}

