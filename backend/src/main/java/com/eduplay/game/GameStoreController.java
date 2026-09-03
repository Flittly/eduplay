package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
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
}

