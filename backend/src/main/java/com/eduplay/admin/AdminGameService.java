package com.eduplay.admin;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.game.GamePackage;
import com.eduplay.game.GamePackageRepository;
import com.eduplay.game.GameProduct;
import com.eduplay.game.GameProductRepository;
import com.eduplay.game.PluginPackageService;
import com.eduplay.game.UserEntitlementRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class AdminGameService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final GamePackageRepository packageRepository;
    private final UserEntitlementRepository entitlementRepository;
    private final PluginPackageService pluginPackageService;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public AdminGameService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            GamePackageRepository packageRepository,
            UserEntitlementRepository entitlementRepository,
            PluginPackageService pluginPackageService
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.packageRepository = packageRepository;
        this.entitlementRepository = entitlementRepository;
        this.pluginPackageService = pluginPackageService;
    }

    @Transactional(readOnly = true)
    public List<GameResponse> listGames(String authorization) {
        authService.requireAdmin(authorization);
        return gameProductRepository.findAll().stream()
                .sorted(Comparator.comparing(GameProduct::getId))
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public GameResponse createGame(String authorization, CreateGameRequest request) {
        authService.requireAdmin(authorization);
        String gameCode = request.gameCode().trim();
        if (gameProductRepository.findByGameCode(gameCode).isPresent()) {
            throw new BusinessException("GAME_CODE_EXISTS", "游戏代码已存在");
        }

        GameProduct product = new GameProduct();
        product.setGameCode(gameCode);
        product.setName(request.name().trim());
        product.setDescription(request.description());
        product.setPriceCents(request.priceCents() == null ? 0 : request.priceCents());
        product.setStatus("DRAFT");
        product.setVersion("0.0.0");
        product.setEntry(gameCode);
        gameProductRepository.save(product);
        return toResponse(product);
    }

    @Transactional
    public GameResponse updateStatus(
            String authorization,
            Long gameId,
            String status
    ) {
        authService.requireAdmin(authorization);
        GameProduct product = gameProductRepository.findById(gameId)
                .orElseThrow(() -> new NotFoundException("游戏不存在"));
        String normalized = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
        if (!"DRAFT".equals(normalized) && !"ACTIVE".equals(normalized)) {
            throw new BusinessException("INVALID_STATUS", "状态只能是 DRAFT 或 ACTIVE");
        }
        product.setStatus(normalized);
        gameProductRepository.save(product);
        return toResponse(product);
    }

    @Transactional
    public GameResponse uploadPackage(
            String authorization,
            String gameCode,
            MultipartFile file
    ) {
        authService.requireAdmin(authorization);
        GameProduct product = gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new NotFoundException("游戏不存在"));

        if (file.isEmpty()) {
            throw new BusinessException("EMPTY_FILE", "请选择插件包文件");
        }

        try {
            byte[] bytes = file.getBytes();
            ManifestInfo manifest = readManifest(bytes, gameCode);
            String packageName = sanitize(gameCode) + "-" + sanitizeVersion(manifest.version()) + ".zip";

            pluginPackageService.savePackage(packageName, bytes);
            long size = bytes.length;
            String sha256 = pluginPackageService.computeSha256(
                    pluginPackageService.resolvePackage(toTempPackage(gameCode, packageName))
            );

            GamePackage gamePackage = packageRepository
                    .findByGameIdAndVersion(product.getId(), manifest.version())
                    .orElseGet(GamePackage::new);
            gamePackage.setGameId(product.getId());
            gamePackage.setVersion(manifest.version());
            gamePackage.setPackageName(packageName);
            gamePackage.setSha256(sha256);
            gamePackage.setSizeBytes(size);
            gamePackage.setStatus("PUBLISHED");
            packageRepository.save(gamePackage);

            product.setVersion(manifest.version());
            product.setName(manifest.name());
            if (manifest.description() != null) {
                product.setDescription(manifest.description());
            }
            product.setEntry(manifest.entry() == null ? gameCode : manifest.entry());
            gameProductRepository.save(product);
            return toResponse(product);
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    private GamePackage toTempPackage(String gameCode, String packageName) {
        GamePackage gamePackage = new GamePackage();
        gamePackage.setPackageName(packageName);
        return gamePackage;
    }

    private ManifestInfo readManifest(byte[] bytes, String expectedGameCode)
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
                    if (!expectedGameCode.equals(gameCode)) {
                        throw new BusinessException(
                                "MANIFEST_MISMATCH",
                                "插件包中的 gameCode 与游戏不匹配"
                        );
                    }
                    if (version.isBlank() || name.isBlank()) {
                        throw new BusinessException(
                                "INVALID_MANIFEST",
                                "manifest.json 缺少 version 或 name"
                        );
                    }
                    return new ManifestInfo(
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

    private GameResponse toResponse(GameProduct product) {
        return new GameResponse(
                product.getId(),
                product.getGameCode(),
                product.getName(),
                product.getDescription(),
                product.getPriceCents(),
                product.getStatus(),
                product.getVersion(),
                entitlementRepository.countByGameId(product.getId()),
                0,
                packageRepository.findByGameIdOrderByVersionDesc(product.getId()).size()
        );
    }

    private record ManifestInfo(
            String version,
            String name,
            String description,
            String entry
    ) {
    }

    public record CreateGameRequest(
            String gameCode,
            String name,
            String description,
            Integer priceCents
    ) {
    }

    public record GameResponse(
            Long id,
            String gameCode,
            String name,
            String description,
            Integer priceCents,
            String status,
            String version,
            long entitlementCount,
            long installCount,
            long packageVersionCount
    ) {
    }
}
