package com.eduplay.admin;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.game.GameProduct;
import com.eduplay.game.GameProductRepository;
import com.eduplay.game.GameProductTag;
import com.eduplay.game.GameProductTagRepository;
import com.eduplay.game.GameTag;
import com.eduplay.game.GameTagRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AdminTagService {

    private final AuthService authService;
    private final GameTagRepository tagRepository;
    private final GameProductTagRepository productTagRepository;
    private final GameProductRepository productRepository;

    public AdminTagService(
            AuthService authService,
            GameTagRepository tagRepository,
            GameProductTagRepository productTagRepository,
            GameProductRepository productRepository
    ) {
        this.authService = authService;
        this.tagRepository = tagRepository;
        this.productTagRepository = productTagRepository;
        this.productRepository = productRepository;
    }

    @Transactional(readOnly = true)
    public List<TagResponse> listTags(String authorization) {
        authService.requireAdmin(authorization);
        return tagRepository.findAll().stream()
                .sorted(java.util.Comparator
                        .comparing(GameTag::getCategory)
                        .thenComparing(GameTag::getSortOrder)
                        .thenComparing(GameTag::getId))
                .map(TagResponse::from)
                .toList();
    }

    @Transactional
    public TagResponse createTag(String authorization, CreateTagRequest request) {
        authService.requireAdmin(authorization);
        String code = request.code() == null ? "" : request.code().trim().toUpperCase(Locale.ROOT);
        String name = request.name() == null ? "" : request.name().trim();
        if (code.isBlank() || name.isBlank()) {
            throw new BusinessException("INVALID_TAG", "标签代码和名称不能为空");
        }
        if (tagRepository.existsByCode(code)) {
            throw new BusinessException("TAG_CODE_EXISTS", "标签代码已存在");
        }

        GameTag tag = new GameTag();
        tag.setCategory(normalizeCategory(request.category()));
        tag.setCode(code);
        tag.setName(name);
        tag.setStatus("ACTIVE");
        tag.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        tag.setCreatedAt(Instant.now());
        tagRepository.save(tag);
        return TagResponse.from(tag);
    }

    @Transactional(readOnly = true)
    public List<TagResponse> listGameTags(String authorization, Long gameId) {
        authService.requireAdmin(authorization);
        productRepository.findById(gameId)
                .orElseThrow(() -> new NotFoundException("游戏不存在"));
        return productTagRepository.findByGameId(gameId).stream()
                .map(link -> tagRepository.findById(link.getTagId()).orElse(null))
                .filter(java.util.Objects::nonNull)
                .sorted(java.util.Comparator
                        .comparing(GameTag::getCategory)
                        .thenComparing(GameTag::getSortOrder))
                .map(TagResponse::from)
                .toList();
    }

    @Transactional
    public List<TagResponse> setGameTags(
            String authorization,
            Long gameId,
            Set<Long> tagIds
    ) {
        authService.requireAdmin(authorization);
        GameProduct product = productRepository.findById(gameId)
                .orElseThrow(() -> new NotFoundException("游戏不存在"));

        List<GameTag> tags = tagIds == null
                ? List.of()
                : tagIds.stream()
                        .map(id -> tagRepository.findById(id).orElse(null))
                        .filter(java.util.Objects::nonNull)
                        .filter(tag -> "ACTIVE".equals(tag.getStatus()))
                        .toList();

        productTagRepository.deleteByGameId(product.getId());
        for (GameTag tag : tags) {
            GameProductTag link = new GameProductTag();
            link.setGameId(product.getId());
            link.setTagId(tag.getId());
            link.setCreatedAt(Instant.now());
            productTagRepository.save(link);
        }
        return tags.stream()
                .sorted(java.util.Comparator
                        .comparing(GameTag::getCategory)
                        .thenComparing(GameTag::getSortOrder))
                .map(TagResponse::from)
                .toList();
    }

    private String normalizeCategory(String category) {
        String normalized = category == null
                ? ""
                : category.trim().toUpperCase(Locale.ROOT);
        if (!"GRADE".equals(normalized)
                && !"TEXTBOOK".equals(normalized)
                && !"TOPIC".equals(normalized)
                && !"OTHER".equals(normalized)) {
            throw new BusinessException(
                    "INVALID_CATEGORY",
                    "标签类别只能是 GRADE/TEXTBOOK/TOPIC/OTHER"
            );
        }
        return normalized;
    }

    public record CreateTagRequest(
            String category,
            String code,
            String name,
            Integer sortOrder
    ) {
    }

    public record TagResponse(
            Long id,
            String category,
            String code,
            String name,
            String status,
            Integer sortOrder
    ) {
        public static TagResponse from(GameTag tag) {
            return new TagResponse(
                    tag.getId(),
                    tag.getCategory(),
                    tag.getCode(),
                    tag.getName(),
                    tag.getStatus(),
                    tag.getSortOrder()
            );
        }
    }
}
