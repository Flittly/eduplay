package com.eduplay.admin;

import com.eduplay.auth.AuthContext;

import com.eduplay.common.BusinessException;
import com.eduplay.game.ActivationCode;
import com.eduplay.game.ActivationCodeRepository;
import com.eduplay.game.GameProductRepository;
import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class AdminCodeService {

    private static final String ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final ActivationCodeRepository activationCodeRepository;
    private final AppUserRepository userRepository;
    private final GameProductRepository gameProductRepository;
    private final SecureRandom secureRandom = new SecureRandom();

    public AdminCodeService(
            ActivationCodeRepository activationCodeRepository,
            AppUserRepository userRepository,
            GameProductRepository gameProductRepository
    ) {
        this.activationCodeRepository = activationCodeRepository;
        this.userRepository = userRepository;
        this.gameProductRepository = gameProductRepository;
    }

    @Transactional(readOnly = true)
    public List<CodeResponse> listCodes() {
        AuthContext.requireAdmin();
        List<ActivationCode> codes = activationCodeRepository.findAllByOrderByCreatedAtDesc();
        // 用过的激活码原先每行一次 findById，500 个码就是 500 次查询；
        // 这里一次性把涉及到的用户捞出来做映射。
        Map<Long, String> usernameById = userRepository.findAllById(
                        codes.stream()
                                .map(ActivationCode::getUsedByUserId)
                                .filter(Objects::nonNull)
                                .distinct()
                                .toList()
                ).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getUsername));
        return codes.stream()
                .map(code -> toResponse(code, usernameById))
                .toList();
    }

    @Transactional
    public List<CodeResponse> generateCodes(
            String gameCode,
            int count
    ) {
        AuthContext.requireAdmin();
        if (gameCode == null || gameCode.isBlank()) {
            throw new BusinessException("INVALID_GAME", "游戏代码不能为空");
        }
        if (count < 1 || count > 500) {
            throw new BusinessException("INVALID_COUNT", "单次生成数量应在1到500之间");
        }
        String normalizedGameCode = gameCode.trim();
        // 不校验就生成，等于凭空造出一批「兑换时必然报 GAME_NOT_FOUND」的废码：
        // 码是真的、发出去收不回，老师兑换时才失败。
        gameProductRepository.findByGameCode(normalizedGameCode)
                .orElseThrow(() -> new BusinessException(
                        "GAME_NOT_FOUND",
                        "游戏 " + normalizedGameCode + " 不存在，请先创建游戏"
                ));

        List<ActivationCode> batch = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            ActivationCode code = new ActivationCode();
            code.setGameCode(normalizedGameCode);
            code.setCode(generateCode(normalizedGameCode));
            code.setStatus("UNUSED");
            batch.add(code);
        }
        // 一次性 saveAll：原先逐条 save，500 条就是 500 次 INSERT 往返。
        List<ActivationCode> saved = activationCodeRepository.saveAll(batch);
        return saved.stream()
                .map(code -> toResponse(code, Map.of()))
                .toList();
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

    private CodeResponse toResponse(ActivationCode code, Map<Long, String> usernameById) {
        String usedBy = code.getUsedByUserId() == null
                ? null
                : usernameById.get(code.getUsedByUserId());
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
