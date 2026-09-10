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
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
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
    private final GameTagRepository tagRepository;
    private final GameProductTagRepository productTagRepository;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public GameStoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserGameInstallRepository installRepository,
            UserEntitlementRepository entitlementRepository,
            GamePackageRepository packageRepository,
            ActivationCodeRepository activationCodeRepository,
            PluginPackageService pluginPackageService,
            GameTagRepository tagRepository,
            GameProductTagRepository productTagRepository
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.installRepository = installRepository;
        this.entitlementRepository = entitlementRepository;
        this.packageRepository = packageRepository;
        this.activationCodeRepository = activationCodeRepository;
        this.pluginPackageService = pluginPackageService;
        this.tagRepository = tagRepository;
        this.productTagRepository = productTagRepository;
    }

    @Transactional(readOnly = true)
    public List<StoreGameResponse> listStoreGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<GameProduct> products = gameProductRepository.findByStatusOrderByIdAsc("ACTIVE");
        List<UserEntitlement> entitlements =
                entitlementRepository.findByUserIdAndStatus(teacher.getId(), "ACTIVE");
        List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());

        // 1 次批量查询，替代每个游戏各查一次最新版本
        Map<Long, String> latestVersionByGame = latestVersionsOf(
                products.stream().map(GameProduct::getId).toList()
        );

        return products.stream()
                .map(game -> toStoreGame(game, entitlements, installs, latestVersionByGame))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<InstalledGameResponse> listInstalledGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);

        // ① 1 次：找出要展示的安装记录
        List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());
        if (installs.isEmpty()) {
            return List.of();
        }
        List<Long> gameIds = installs.stream()
                .map(UserGameInstall::getGameId)
                .distinct()
                .toList();

        // ② 1 次：批量拿游戏（替代 N 次 findById），ACTIVE 过滤条件保持不变
        Map<Long, GameProduct> gameById = gameProductRepository.findAllById(gameIds).stream()
                .filter(game -> "ACTIVE".equals(game.getStatus()))
                .collect(Collectors.toMap(GameProduct::getId, Function.identity()));

        // ③ 1 次：批量拿各游戏最新版本（替代 N 次 findFirstByGameIdOrderByVersionDesc）
        Map<Long, String> latestVersionByGame = latestVersionsOf(gameIds);

        // ④ 1 次：批量拿标签关联
        List<GameProductTag> tagLinks = productTagRepository.findByGameIdIn(gameIds);
        Map<Long, List<GameProductTag>> tagLinksByGame = tagLinks.stream()
                .collect(Collectors.groupingBy(GameProductTag::getGameId));

        // ⑤ 1 次：批量拿标签本体（替代 N×M 次 findById）
        Map<Long, GameTag> tagById = tagRepository
                .findAllById(tagLinks.stream().map(GameProductTag::getTagId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(GameTag::getId, Function.identity()));

        // ⑥ 0 次查询：全部在内存中组装
        Map<Long, UserGameInstall> installByGame = installs.stream()
                .collect(Collectors.toMap(
                        UserGameInstall::getGameId,
                        Function.identity(),
                        (first, second) -> first
                ));

        return gameIds.stream()
                .map(gameId -> {
                    GameProduct game = gameById.get(gameId);
                    UserGameInstall install = installByGame.get(gameId);
                    if (game == null || install == null) {
                        return null;
                    }
                    return toInstalledGame(
                            game,
                            install,
                            latestVersionByGame,
                            tagLinksByGame,
                            tagById
                    );
                })
                .filter(Objects::nonNull)
                .toList();
    }

    /**
     * 批量取多个游戏的最新版本号，1 次查询返回 Map（gameId → version）。
     * 空集合直接返回空 Map，避免不同数据库对 {@code IN ()} 的处理差异。
     */
    private Map<Long, String> latestVersionsOf(List<Long> gameIds) {
        if (gameIds.isEmpty()) {
            return Map.of();
        }
        return packageRepository.findLatestVersions(gameIds).stream()
                .collect(Collectors.toMap(
                        GamePackage::getGameId,
                        GamePackage::getVersion,
                        (first, second) -> first
                ));
    }

    /**
     * 取某个游戏的最新版本号。已预取时走内存（0 次查询），
     * 否则回退为单次查询——与改造前的行为完全一致。
     */
    private String latestVersionOf(GameProduct game, Map<Long, String> latestVersionByGame) {
        if (latestVersionByGame != null) {
            String preloaded = latestVersionByGame.get(game.getId());
            if (preloaded != null) {
                return preloaded;
            }
        }
        return packageRepository.findFirstByGameIdOrderByVersionDesc(game.getId())
                .map(GamePackage::getVersion)
                .orElse(game.getVersion());
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
            if (manifest.cover() != null && !manifest.cover().isBlank()) {
                product.setCoverUrl("/api/v1/store/games/" + gameCode + "/cover");
            }
            product.setPriceCents(product.getPriceCents() == null ? 0 : product.getPriceCents());
            product.setStatus("ACTIVE");
            gameProductRepository.save(product);
            syncManifestTags(product, manifest.tags());

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

    /**
     * 读取游戏封面：直接从最新已发布插件包 zip 内提取 manifest.cover 指向的文件，
     * 不落库、不额外占用存储（封面随包走）。未声明 cover 时按约定路径回退查找。
     */
    @Transactional(readOnly = true)
    public CoverFile downloadCover(String gameCode) {
        GameProduct game = getGame(gameCode);
        GamePackage gamePackage = packageRepository
                .findFirstByGameIdOrderByVersionDesc(game.getId())
                .orElseThrow(() -> new BusinessException("PACKAGE_NOT_FOUND", "插件包不存在"));
        try (ZipFile zipFile = new ZipFile(
                pluginPackageService.resolvePackage(gamePackage).toFile())) {
            String coverPath = null;
            ZipEntry manifestEntry = zipFile.getEntry("manifest.json");
            if (manifestEntry != null) {
                String content = new String(
                        zipFile.getInputStream(manifestEntry).readAllBytes(),
                        StandardCharsets.UTF_8
                );
                String cover = jsonMapper.readTree(content).path("cover").asText(null);
                if (cover != null && !cover.isBlank()) {
                    coverPath = cover;
                }
            }
            ZipEntry entry = coverPath == null ? null : zipFile.getEntry(coverPath);
            if (entry == null) {
                for (String candidate : new String[]{
                        "web/cover.svg", "web/cover.png", "cover.svg", "cover.png"
                }) {
                    entry = zipFile.getEntry(candidate);
                    if (entry != null) {
                        break;
                    }
                }
            }
            if (entry == null) {
                throw new BusinessException("COVER_NOT_FOUND", "插件包内没有封面文件");
            }
            byte[] bytes = zipFile.getInputStream(entry).readAllBytes();
            String name = entry.getName().toLowerCase(Locale.ROOT);
            String contentType = name.endsWith(".png") ? "image/png"
                    : name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg"
                    : name.endsWith(".webp") ? "image/webp"
                    : "image/svg+xml";
            return new CoverFile(bytes, contentType);
        } catch (BusinessException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "封面读取失败");
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
        return toStoreGame(game, entitlements, installs, null);
    }

    private StoreGameResponse toStoreGame(
            GameProduct game,
            List<UserEntitlement> entitlements,
            List<UserGameInstall> installs,
            Map<Long, String> latestVersionByGame
    ) {
        UserEntitlement entitlement = entitlements.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);
        UserGameInstall install = installs.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);
        String latestVersion = latestVersionOf(game, latestVersionByGame);
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
            UserGameInstall install,
            Map<Long, String> latestVersionByGame,
            Map<Long, List<GameProductTag>> tagLinksByGame,
            Map<Long, GameTag> tagById
    ) {
        String latestVersion = latestVersionOf(game, latestVersionByGame);
        return new InstalledGameResponse(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                latestVersion,
                install.getInstalledVersion(),
                install.getStatus(),
                !Objects.equals(install.getInstalledVersion(), latestVersion),
                tagsFor(game.getId(), tagLinksByGame, tagById)
        );
    }

    private List<TagItem> tagsFor(
            Long gameId,
            Map<Long, List<GameProductTag>> tagLinksByGame,
            Map<Long, GameTag> tagById
    ) {
        return tagLinksByGame.getOrDefault(gameId, List.of()).stream()
                .map(link -> tagById.get(link.getTagId()))
                .filter(Objects::nonNull)
                .filter(tag -> "ACTIVE".equals(tag.getStatus()))
                .sorted(Comparator.comparing(GameTag::getCategory)
                        .thenComparing(GameTag::getSortOrder))
                .map(tag -> new TagItem(tag.getCategory(), tag.getName()))
                .toList();
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
                            gameCode,
                            version,
                            name,
                            root.path("description").asText(null),
                            root.path("entry").asText(null),
                            root.path("cover").asText(null),
                            root.path("tags")
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

    private void syncManifestTags(GameProduct product, JsonNode tagsNode) {
        if (tagsNode == null || tagsNode.isMissingNode() || !tagsNode.isObject()) {
            return;
        }
        productTagRepository.deleteByGameId(product.getId());
        Map<String, String> mapping = Map.of(
                "grades", "GRADE",
                "textbooks", "TEXTBOOK",
                "topics", "TOPIC",
                "other", "OTHER"
        );
        mapping.forEach((key, category) -> {
            JsonNode values = tagsNode.path(key);
            if (!values.isArray()) {
                return;
            }
            values.forEach(value -> {
                String name = value.asText("").trim();
                if (name.isBlank()) {
                    return;
                }
                String code = category + "_"
                        + name.replaceAll("\\s+", "_").toUpperCase(Locale.ROOT);
                GameTag tag = tagRepository.findByCode(code).orElseGet(() -> {
                    GameTag created = new GameTag();
                    created.setCategory(category);
                    created.setCode(code);
                    created.setName(name);
                    created.setStatus("ACTIVE");
                    created.setSortOrder((int) tagRepository.count());
                    created.setCreatedAt(Instant.now());
                    return tagRepository.save(created);
                });
                GameProductTag link = new GameProductTag();
                link.setGameId(product.getId());
                link.setTagId(tag.getId());
                link.setCreatedAt(Instant.now());
                productTagRepository.save(link);
            });
        });
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
            boolean updateAvailable,
            List<TagItem> tags
    ) {
    }

    public record TagItem(
            String category,
            String name
    ) {
    }

    public record RedeemResult(
            String gameCode,
            String gameName,
            String status
    ) {
    }

    private record PluginManifest(
            String gameCode,
            String version,
            String name,
            String description,
            String entry,
            String cover,
            JsonNode tags
    ) {
    }

    public record CoverFile(byte[] content, String contentType) {
    }
}
