package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.springframework.context.annotation.Profile;

@Service
@Profile("local")
public class GameStoreService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final UserGameInstallRepository installRepository;
    private final UserEntitlementRepository entitlementRepository;
    private final GamePackageRepository packageRepository;
    private final ActivationCodeRepository activationCodeRepository;
    private final PluginPackageService pluginPackageService;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public GameStoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserGameInstallRepository installRepository,
            UserEntitlementRepository entitlementRepository,
            GamePackageRepository packageRepository,
            ActivationCodeRepository activationCodeRepository,
            PluginPackageService pluginPackageService
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.installRepository = installRepository;
        this.entitlementRepository = entitlementRepository;
        this.packageRepository = packageRepository;
        this.activationCodeRepository = activationCodeRepository;
        this.pluginPackageService = pluginPackageService;
    }

    @Transactional(readOnly = true)
    public List<StoreGameResponse> listStoreGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<GameProduct> products = gameProductRepository.findByStatusOrderByIdAsc("ACTIVE");
        List<UserEntitlement> entitlements =
                entitlementRepository.findByUserIdAndStatus(teacher.getId(), "ACTIVE");
        List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());

        return products.stream()
                .map(game -> toStoreGame(game, entitlements, installs))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<InstalledGameResponse> listInstalledGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        return installRepository.findByUserId(teacher.getId()).stream()
                .map(install -> gameProductRepository.findById(install.getGameId())
                        .filter(game -> "ACTIVE".equals(game.getStatus()))
                        .map(game -> toInstalledGame(game, install))
                        .orElse(null))
                .filter(Objects::nonNull)
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

    @Transactional
    public StoreGameResponse installGame(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        ensureEntitlement(teacher.getId(), game);

        GamePackage gamePackage = packageRepository.findFirstByGameIdOrderByVersionDesc(game.getId())
                .orElseThrow(() -> new BusinessException(
                        "PACKAGE_NOT_FOUND",
                        "该游戏还没有发布插件包"
                ));

        pluginPackageService.install(teacher.getId(), game, gamePackage);

        UserGameInstall install = installRepository
                .findByUserIdAndGameId(teacher.getId(), game.getId())
                .orElseGet(UserGameInstall::new);
        install.setUserId(teacher.getId());
        install.setGameId(game.getId());
        install.setInstalledVersion(gamePackage.getVersion());
        install.setStatus("INSTALLED");
        if (install.getInstalledAt() == null) {
            install.setInstalledAt(Instant.now());
        }
        installRepository.save(install);

        List<UserEntitlement> entitlements =
                entitlementRepository.findByUserIdAndStatus(teacher.getId(), "ACTIVE");
        List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());
        return toStoreGame(game, entitlements, installs);
    }

    @Transactional
    public StoreGameResponse installDownloadedPackage(
            String authorizationHeader,
            String gameCode,
            MultipartFile file
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        if (file.isEmpty()) {
            throw new BusinessException("EMPTY_FILE", "请选择插件包文件");
        }

        try {
            byte[] bytes = file.getBytes();
            PluginManifest manifest = readManifest(bytes, gameCode);
            String packageName = sanitize(gameCode) + "-"
                    + sanitizeVersion(manifest.version()) + ".zip";

            pluginPackageService.savePackage(packageName, bytes);

            GameProduct product = gameProductRepository.findByGameCode(gameCode)
                    .orElseGet(GameProduct::new);
            if (product.getId() == null) {
                product.setGameCode(gameCode);
                product.setStatus("ACTIVE");
            }
            product.setName(manifest.name());
            if (manifest.description() != null) {
                product.setDescription(manifest.description());
            }
            product.setVersion(manifest.version());
            product.setEntry(manifest.entry() == null ? gameCode : manifest.entry());
            product.setPriceCents(product.getPriceCents() == null ? 0 : product.getPriceCents());
            product.setStatus("ACTIVE");
            gameProductRepository.save(product);

            GamePackage gamePackage = packageRepository
                    .findByGameIdAndVersion(product.getId(), manifest.version())
                    .orElseGet(GamePackage::new);
            gamePackage.setGameId(product.getId());
            gamePackage.setVersion(manifest.version());
            gamePackage.setPackageName(packageName);
            gamePackage.setSha256(pluginPackageService.computeSha256(
                    pluginPackageService.resolvePackage(gamePackage)
            ));
            gamePackage.setSizeBytes((long) bytes.length);
            gamePackage.setStatus("PUBLISHED");
            packageRepository.save(gamePackage);

            pluginPackageService.install(teacher.getId(), product, gamePackage);

            UserGameInstall install = installRepository
                    .findByUserIdAndGameId(teacher.getId(), product.getId())
                    .orElseGet(UserGameInstall::new);
            install.setUserId(teacher.getId());
            install.setGameId(product.getId());
            install.setInstalledVersion(manifest.version());
            install.setStatus("INSTALLED");
            if (install.getInstalledAt() == null) {
                install.setInstalledAt(Instant.now());
            }
            installRepository.save(install);

            List<UserEntitlement> entitlements =
                    entitlementRepository.findByUserIdAndStatus(teacher.getId(), "ACTIVE");
            List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());
            return toStoreGame(product, entitlements, installs);
        } catch (BusinessException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    @Transactional
    public StoreGameResponse importDownloadedPackage(
            String authorizationHeader,
            MultipartFile file
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        if (file.isEmpty()) {
            throw new BusinessException("EMPTY_FILE", "请选择插件包文件");
        }
        try {
            PluginManifest manifest = readManifest(file.getBytes());
            return installDownloadedPackage(
                    authorizationHeader,
                    manifest.gameCode(),
                    file
            );
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    @Transactional
    public void uninstallGame(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        pluginPackageService.uninstall(teacher.getId(), gameCode);
        installRepository.findByUserIdAndGameId(teacher.getId(), game.getId())
                .ifPresent(installRepository::delete);
    }

    @Transactional(readOnly = true)
    public byte[] downloadPackage(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        GamePackage gamePackage = packageRepository.findFirstByGameIdOrderByVersionDesc(game.getId())
                .orElseThrow(() -> new BusinessException("PACKAGE_NOT_FOUND", "插件包不存在"));
        try {
            return Files.readAllBytes(pluginPackageService.resolvePackage(gamePackage));
        } catch (Exception ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    @Transactional(readOnly = true)
    public String installedManifest(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        UserGameInstall install = installRepository
                .findByUserIdAndGameId(teacher.getId(), game.getId())
                .orElseThrow(() -> new BusinessException("GAME_NOT_INSTALLED", "游戏未安装"));
        String manifest = pluginPackageService.readManifest(
                teacher.getId(),
                game,
                install.getInstalledVersion()
        );
        if (manifest == null) {
            throw new BusinessException("MANIFEST_NOT_FOUND", "插件清单不存在");
        }
        return manifest;
    }

    private void ensureEntitlement(Long userId, GameProduct game) {
        UserEntitlement entitlement = entitlementRepository
                .findByUserIdAndGameId(userId, game.getId())
                .orElse(null);
        if (entitlement == null || !"ACTIVE".equals(entitlement.getStatus())) {
            throw new BusinessException(
                    "ENTITLEMENT_REQUIRED",
                    "请先使用激活码兑换该游戏"
            );
        }
    }

    private StoreGameResponse toStoreGame(
            GameProduct game,
            List<UserEntitlement> entitlements,
            List<UserGameInstall> installs
    ) {
        UserEntitlement entitlement = entitlements.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);
        UserGameInstall install = installs.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);
        String latestVersion = packageRepository.findFirstByGameIdOrderByVersionDesc(game.getId())
                .map(GamePackage::getVersion)
                .orElse(game.getVersion());
        boolean updateAvailable = install != null
                && !Objects.equals(install.getInstalledVersion(), latestVersion);

        return new StoreGameResponse(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                game.getPriceCents(),
                latestVersion,
                entitlement != null && "ACTIVE".equals(entitlement.getStatus()),
                entitlement == null ? null : entitlement.getSource(),
                install != null,
                install == null ? null : install.getInstalledVersion(),
                updateAvailable
        );
    }

    private InstalledGameResponse toInstalledGame(
            GameProduct game,
            UserGameInstall install
    ) {
        String latestVersion = packageRepository.findFirstByGameIdOrderByVersionDesc(game.getId())
                .map(GamePackage::getVersion)
                .orElse(game.getVersion());
        return new InstalledGameResponse(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                latestVersion,
                install.getInstalledVersion(),
                install.getStatus(),
                !Objects.equals(install.getInstalledVersion(), latestVersion)
        );
    }

    private PluginManifest readManifest(byte[] bytes, String expectedGameCode)
            throws IOException {
        PluginManifest manifest = readManifest(bytes);
        if (!expectedGameCode.equals(manifest.gameCode())) {
            throw new BusinessException(
                    "MANIFEST_MISMATCH",
                    "插件包中的 gameCode 与游戏不匹配"
            );
        }
        return manifest;
    }

    private PluginManifest readManifest(byte[] bytes)
            throws IOException {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if ("manifest.json".equals(entry.getName())) {
                    String content = new String(
                            zip.readAllBytes(),
                            StandardCharsets.UTF_8
                    );
                    JsonNode root = jsonMapper.readTree(content);
                    String gameCode = root.path("gameCode").asText();
                    String version = root.path("version").asText();
                    String name = root.path("name").asText();
                    if (version.isBlank() || name.isBlank()) {
                        throw new BusinessException(
                                "INVALID_MANIFEST",
                                "manifest.json 缺少 version 或 name"
                        );
                    }
                    return new PluginManifest(
                            version,
                            name,
                            root.path("description").asText(null),
                            root.path("entry").asText(null)
                    );
                }
                zip.closeEntry();
            }
        }
        throw new BusinessException("INVALID_PACKAGE", "插件包缺少 manifest.json");
    }

    private String sanitize(String value) {
        return value.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    private String sanitizeVersion(String version) {
        return version.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private AppUser requireTeacher(String authorizationHeader) {
        AppUser user = authService.requireUser(authorizationHeader);
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以使用商城");
        }
        return user;
    }

    private GameProduct getGame(String gameCode) {
        return gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));
    }

    public record StoreGameResponse(
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

    public record InstalledGameResponse(
            Long id,
            String gameCode,
            String name,
            String description,
            String coverUrl,
            String version,
            String installedVersion,
            String status,
            boolean updateAvailable
    ) {
    }

    public record RedeemResult(
            String gameCode,
            String gameName,
            String status
    ) {
    }

    private record PluginManifest(
            String version,
            String name,
            String description,
            String entry
    ) {
    }
}
