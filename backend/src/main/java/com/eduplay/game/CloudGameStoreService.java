package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

@Service
@Profile("cloud")
public class CloudGameStoreService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final UserEntitlementRepository entitlementRepository;
    private final GamePackageRepository packageRepository;
    private final ActivationCodeRepository activationCodeRepository;
    private final PluginPackageService pluginPackageService;

    public CloudGameStoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserEntitlementRepository entitlementRepository,
            GamePackageRepository packageRepository,
            ActivationCodeRepository activationCodeRepository,
            PluginPackageService pluginPackageService
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.entitlementRepository = entitlementRepository;
        this.packageRepository = packageRepository;
        this.activationCodeRepository = activationCodeRepository;
        this.pluginPackageService = pluginPackageService;
    }

    @Transactional(readOnly = true)
    public List<CloudStoreGame> listStoreGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<GameProduct> products = gameProductRepository.findByStatusOrderByIdAsc("ACTIVE");
        List<UserEntitlement> entitlements =
                entitlementRepository.findByUserIdAndStatus(teacher.getId(), "ACTIVE");

        return products.stream()
                .map(game -> toStoreGame(game, entitlements))
                .toList();
    }

    @Transactional
    public RedeemResult redeemCode(String authorizationHeader, String rawCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        String codeValue = rawCode == null ? "" : rawCode.trim().toUpperCase();
        ActivationCode code = activationCodeRepository.findByCode(codeValue)
                .orElseThrow(() -> new BusinessException("INVALID_CODE", "激活码不存在"));

        if ("USED".equals(code.getStatus())) {
            throw new BusinessException("CODE_ALREADY_USED", "激活码已被使用");
        }

        GameProduct game = gameProductRepository.findByGameCode(code.getGameCode())
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "激活码对应游戏不存在"));

        entitlementRepository.findByUserIdAndGameId(teacher.getId(), game.getId())
                .ifPresent(existing -> {
                    if ("ACTIVE".equals(existing.getStatus())) {
                        throw new BusinessException(
                                "ALREADY_OWNED",
                                "你已经拥有该游戏，无需重复兑换"
                        );
                    }
                });

        UserEntitlement entitlement = new UserEntitlement();
        entitlement.setUserId(teacher.getId());
        entitlement.setGameId(game.getId());
        entitlement.setSource("ACTIVATION_CODE");
        entitlement.setStatus("ACTIVE");
        entitlement.setGrantedAt(Instant.now());
        entitlementRepository.save(entitlement);

        code.setStatus("USED");
        code.setUsedByUserId(teacher.getId());
        code.setUsedAt(Instant.now());
        activationCodeRepository.save(code);

        return new RedeemResult(game.getGameCode(), game.getName(), "ACTIVE");
    }

    @Transactional(readOnly = true)
    public byte[] downloadPackage(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        GamePackage gamePackage = packageRepository
                .findFirstByGameIdOrderByVersionDesc(game.getId())
                .orElseThrow(() -> new BusinessException("PACKAGE_NOT_FOUND", "插件包不存在"));
        try {
            return Files.readAllBytes(pluginPackageService.resolvePackage(gamePackage));
        } catch (Exception ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    private CloudStoreGame toStoreGame(
            GameProduct game,
            List<UserEntitlement> entitlements
    ) {
        UserEntitlement entitlement = entitlements.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);
        String latestVersion = packageRepository
                .findFirstByGameIdOrderByVersionDesc(game.getId())
                .map(GamePackage::getVersion)
                .orElse(game.getVersion());

        boolean owned = entitlement != null && "ACTIVE".equals(entitlement.getStatus());
        return new CloudStoreGame(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                game.getPriceCents(),
                latestVersion,
                owned,
                owned ? entitlement.getSource() : null,
                false,
                null,
                false
        );
    }

    private AppUser requireTeacher(String authorizationHeader) {
        AppUser user = authService.requireUser(authorizationHeader);
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以使用云端商城");
        }
        return user;
    }

    private GameProduct getGame(String gameCode) {
        return gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));
    }

    public record CloudStoreGame(
            Long id,
            String gameCode,
            String name,
            String description,
            String coverUrl,
            Integer priceCents,
            String version,
            boolean owned,
            String entitlementSource,
            boolean installed,
            String installedVersion,
            boolean updateAvailable
    ) {
    }

    public record RedeemResult(
            String gameCode,
            String gameName,
            String status
    ) {
    }
}
