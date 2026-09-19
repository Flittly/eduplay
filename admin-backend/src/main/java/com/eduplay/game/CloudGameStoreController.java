package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/v1/store")
public class CloudGameStoreController {

    private final CloudGameStoreService cloudGameStoreService;

    public CloudGameStoreController(CloudGameStoreService cloudGameStoreService) {
        this.cloudGameStoreService = cloudGameStoreService;
    }

    @GetMapping("/games")
    public ApiResponse<List<CloudGameStoreService.CloudStoreGame>> listStoreGames(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(cloudGameStoreService.listStoreGames(authorization));
    }

    @PostMapping("/redeem")
    public ApiResponse<CloudGameStoreService.RedeemResult> redeemCode(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody RedeemCodeRequest request
    ) {
        return ApiResponse.ok(cloudGameStoreService.redeemCode(authorization, request.code()));
    }

    @GetMapping("/games/{gameCode}/package")
    public ResponseEntity<byte[]> downloadPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) {
        byte[] bytes = cloudGameStoreService.downloadPackage(authorization, gameCode);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(gameCode + ".zip", StandardCharsets.UTF_8)
                .build());
        headers.setContentLength(bytes.length);
        return ResponseEntity.ok()
                .headers(headers)
                .body(bytes);
    }

    /** 游戏封面：公开接口（<img> 标签无法携带 token），内容来自插件包内文件 */
    @GetMapping("/games/{gameCode}/cover")
    public ResponseEntity<byte[]> cover(@PathVariable String gameCode) {
        CloudGameStoreService.CoverFile cover = cloudGameStoreService.downloadCover(gameCode);
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.CONTENT_TYPE, cover.contentType());
        headers.setCacheControl("max-age=300");
        return ResponseEntity.ok().headers(headers).body(cover.content());
    }

    public record RedeemCodeRequest(
            @NotBlank(message = "激活码不能为空")
            String code
    ) {
    }
}
