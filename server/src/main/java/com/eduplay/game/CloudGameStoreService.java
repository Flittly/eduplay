package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class CloudGameStoreService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final UserEntitlementRepository entitlementRepository;
    private final GamePackageRepository packageRepository;
    private final ActivationCodeRepository activationCodeRepository;
    private final PluginPackageService pluginPackageService;
    private final GameTagRepository tagRepository;
    private final GameProductTagRepository productTagRepository;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public CloudGameStoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserEntitlementRepository entitlementRepository,
            GamePackageRepository packageRepository,
            ActivationCodeRepository activationCodeRepository,
            PluginPackageService pluginPackageService,
            GameTagRepository tagRepository,
            GameProductTagRepository productTagRepository
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.entitlementRepository = entitlementRepository;
        this.packageRepository = packageRepository;
        this.activationCodeRepository = activationCodeRepository;
        this.pluginPackageService = pluginPackageService;
        this.tagRepository = tagRepository;
        this.productTagRepository = productTagRepository;
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
        UserEntitlement entitlement = entitlementRepository
                .findByUserIdAndGameId(teacher.getId(), game.getId())
                .orElseThrow(() -> new BusinessException(
                        "ENTITLEMENT_REQUIRED",
                        "请先兑换该游戏再下载"
                ));
        if (!"ACTIVE".equals(entitlement.getStatus())) {
            throw new BusinessException("ENTITLEMENT_REQUIRED", "该游戏权益已失效");
        }
        GamePackage gamePackage = packageRepository
                .findFirstByGameIdOrderByVersionDesc(game.getId())
                .orElseThrow(() -> new BusinessException("PACKAGE_NOT_FOUND", "插件包不存在"));
        try {
            byte[] original = Files.readAllBytes(
                    pluginPackageService.resolvePackage(gamePackage)
            );
            return rewriteWithTags(original, game.getId());
        } catch (Exception ex) {
            throw new BusinessException("PACKAGE_READ_FAILED", "插件包读取失败");
        }
    }

    private byte[] rewriteWithTags(byte[] original, Long gameId) throws Exception {
        List<ZipEntryData> entries = new ArrayList<>();
        byte[] manifestBytes = null;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(original))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                byte[] data = zip.readAllBytes();
                if ("manifest.json".equals(entry.getName())) {
                    manifestBytes = data;
                } else {
                    entries.add(new ZipEntryData(entry.getName(), data));
                }
                zip.closeEntry();
            }
        }
        if (manifestBytes == null) {
            throw new BusinessException("INVALID_PACKAGE", "插件包缺少 manifest.json");
        }

        ObjectNode manifest = (ObjectNode) jsonMapper.readTree(manifestBytes);
        ObjectNode tags = jsonMapper.createObjectNode();
        List<GameTag> gameTags = productTagRepository.findByGameId(gameId).stream()
                .map(link -> tagRepository.findById(link.getTagId()).orElse(null))
                .filter(Objects::nonNull)
                .filter(tag -> "ACTIVE".equals(tag.getStatus()))
                .toList();
        putGroup(tags, "grades", gameTags, "GRADE");
        putGroup(tags, "textbooks", gameTags, "TEXTBOOK");
        putGroup(tags, "topics", gameTags, "TOPIC");
        putGroup(tags, "other", gameTags, "OTHER");
        manifest.set("tags", tags);

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(jsonMapper.writeValueAsBytes(manifest));
            zip.closeEntry();
            for (ZipEntryData item : entries) {
                zip.putNextEntry(new ZipEntry(item.name()));
                zip.write(item.bytes());
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private void putGroup(
            ObjectNode target,
            String field,
            List<GameTag> tags,
            String category
    ) {
        ArrayNode array = jsonMapper.createArrayNode();
        tags.stream()
                .filter(tag -> category.equals(tag.getCategory()))
                .forEach(tag -> array.add(tag.getName()));
        target.set(field, array);
    }

    private record ZipEntryData(String name, byte[] bytes) {
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
                false,
                tagsFor(game.getId())
        );
    }

    private List<TagItem> tagsFor(Long gameId) {
        return productTagRepository.findByGameId(gameId).stream()
                .map(link -> tagRepository.findById(link.getTagId()).orElse(null))
                .filter(Objects::nonNull)
                .filter(tag -> "ACTIVE".equals(tag.getStatus()))
                .sorted(Comparator.comparing(GameTag::getCategory)
                        .thenComparing(GameTag::getSortOrder))
                .map(tag -> new TagItem(tag.getCategory(), tag.getName()))
                .toList();
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
}
