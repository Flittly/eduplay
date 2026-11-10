package com.eduplay.admin;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminTagController {

    private final AdminTagService tagService;

    public AdminTagController(AdminTagService tagService) {
        this.tagService = tagService;
    }

    @GetMapping("/tags")
    public ApiResponse<List<AdminTagService.TagResponse>> listTags() {
        return ApiResponse.ok(tagService.listTags());
    }

    @PostMapping("/tags")
    public ApiResponse<AdminTagService.TagResponse> createTag(
            @Valid @RequestBody CreateTagRequest request
    ) {
        AdminTagService.CreateTagRequest serviceRequest =
                new AdminTagService.CreateTagRequest(
                        request.category(),
                        request.code(),
                        request.name(),
                        request.sortOrder()
                );
        return ApiResponse.ok(tagService.createTag(serviceRequest));
    }

    @GetMapping("/games/{gameId}/tags")
    public ApiResponse<List<AdminTagService.TagResponse>> listGameTags(
            @PathVariable Long gameId
    ) {
        return ApiResponse.ok(tagService.listGameTags(gameId));
    }

    @PutMapping("/games/{gameId}/tags")
    public ApiResponse<List<AdminTagService.TagResponse>> setGameTags(
            @PathVariable Long gameId,
            @Valid @RequestBody SetTagsRequest request
    ) {
        return ApiResponse.ok(tagService.setGameTags(
                gameId,
                request.tagIds()
        ));
    }

    public record CreateTagRequest(
            @NotBlank(message = "标签类别不能为空")
            String category,
            @NotBlank(message = "标签代码不能为空")
            @Size(max = 64, message = "标签代码不能超过64位")
            String code,
            @NotBlank(message = "标签名称不能为空")
            @Size(max = 64, message = "标签名称不能超过64位")
            String name,
            Integer sortOrder
    ) {
    }

    public record SetTagsRequest(
            Set<Long> tagIds
    ) {
    }
}
