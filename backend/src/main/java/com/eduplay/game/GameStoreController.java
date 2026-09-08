package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.context.annotation.Profile;

@RestController
@RequestMapping("/api/v1")
@Profile("local")
public class GameStoreController {

    private final GameStoreService gameStoreService;

    public GameStoreController(GameStoreService gameStoreService) {
        this.gameStoreService = gameStoreService;
    }

    @GetMapping("/store/games")
    public ApiResponse<List<GameStoreService.StoreGameResponse>> listStoreGames(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(gameStoreService.listStoreGames(authorization));
    }

    @PostMapping("/store/games/{gameCode}/install")
    public ApiResponse<GameStoreService.StoreGameResponse> installGame(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) {
        return ApiResponse.ok(gameStoreService.installGame(authorization, gameCode));
    }

    @PostMapping(value = "/store/games/{gameCode}/package-install",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<GameStoreService.StoreGameResponse> installDownloadedPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode,
            @RequestParam("file") MultipartFile file
    ) {
        return ApiResponse.ok(gameStoreService.installDownloadedPackage(
                authorization,
                gameCode,
                file
        ));
    }

    @PostMapping(value = "/store/games/import-package",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<GameStoreService.StoreGameResponse> importPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam("file") MultipartFile file
    ) {
        return ApiResponse.ok(gameStoreService.importDownloadedPackage(
                authorization,
                file
        ));
    }

    @PostMapping("/store/redeem")
    public ApiResponse<GameStoreService.RedeemResult> redeemCode(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody RedeemCodeRequest request
    ) {
        return ApiResponse.ok(gameStoreService.redeemCode(authorization, request.code()));
    }

    @GetMapping("/store/games/{gameCode}/package")
    public ResponseEntity<byte[]> downloadPackage(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) {
        byte[] bytes = gameStoreService.downloadPackage(authorization, gameCode);
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

    @GetMapping("/store/games/{gameCode}/manifest")
    public ResponseEntity<String> installedManifest(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(gameStoreService.installedManifest(authorization, gameCode));
    }

    @PostMapping("/store/games/{gameCode}/uninstall")
    public ApiResponse<Void> uninstallGame(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode
    ) {
        gameStoreService.uninstallGame(authorization, gameCode);
        return ApiResponse.ok();
    }

    @GetMapping("/me/games")
    public ApiResponse<List<GameStoreService.InstalledGameResponse>> listInstalledGames(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(gameStoreService.listInstalledGames(authorization));
    }

    public record RedeemCodeRequest(
            @NotBlank(message = "激活码不能为空")
            String code
    ) {
    }
}
