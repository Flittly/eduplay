package com.eduplay.admin;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/v1/admin/games")
public class AdminGameController {

    private final AdminGameService gameService;

    public AdminGameController(AdminGameService gameService) {
        this.gameService = gameService;
    }

    @GetMapping
    public ApiResponse<List<AdminGameService.GameResponse>> list(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(gameService.listGames(authorization));
    }

    @PostMapping
    public ApiResponse<AdminGameService.GameResponse> create(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody CreateGameRequest request
    ) {
        AdminGameService.CreateGameRequest serviceRequest =
                new AdminGameService.CreateGameRequest(
                        request.gameCode(),
                        request.name(),
                        request.description(),
                        request.priceCents()
                );
        return ApiResponse.ok(gameService.createGame(authorization, serviceRequest));
    }

    @PatchMapping("/{gameId}/status")
    public ApiResponse<AdminGameService.GameResponse> updateStatus(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long gameId,
            @Valid @RequestBody StatusRequest request
    ) {
        return ApiResponse.ok(gameService.updateStatus(
                authorization,
                gameId,
                request.status()
        ));
    }

    @PostMapping(value = "/{gameCode}/packages", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<AdminGameService.GameResponse> uploadPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode,
            @RequestParam("file") MultipartFile file
    ) {
        return ApiResponse.ok(gameService.uploadPackage(authorization, gameCode, file));
    }

    @GetMapping("/{gameCode}/package/export")
    public ResponseEntity<byte[]> exportTaggedPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) throws Exception {
        byte[] bytes = gameService.exportTaggedPackage(authorization, gameCode);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(gameCode + "-tagged.zip", StandardCharsets.UTF_8)
                .build());
        headers.setContentLength(bytes.length);
        return ResponseEntity.ok()
                .headers(headers)
                .body(bytes);
    }

    public record CreateGameRequest(
            @NotBlank(message = "游戏代码不能为空")
            String gameCode,
            @NotBlank(message = "游戏名称不能为空")
            String name,
            String description,
            Integer priceCents
    ) {
    }

    public record StatusRequest(
            @NotBlank(message = "状态不能为空")
            @Size(max = 16, message = "状态不能超过16位")
            String status
    ) {
    }
}
