package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/games")
public class GameController {

    private final GameService gameService;

    public GameController(GameService gameService) {
        this.gameService = gameService;
    }

    @GetMapping
    public ApiResponse<List<GameProductResponse>> listGames() {
        List<GameProductResponse> games = gameService.listActiveGames().stream()
                .map(GameProductResponse::from)
                .toList();
        return ApiResponse.ok(games);
    }

    @GetMapping("/{gameCode}")
    public ApiResponse<GameProductResponse> getGame(@PathVariable String gameCode) {
        return ApiResponse.ok(GameProductResponse.from(gameService.getByGameCode(gameCode)));
    }

    @PostMapping("/{gameCode}/sessions")
    public ApiResponse<StartSessionResponse> startSession(
            @PathVariable String gameCode,
            @Valid @RequestBody StartSessionRequest request
    ) {
        String sessionNo = gameService.startSession(request.userId(), gameCode);
        return ApiResponse.ok(new StartSessionResponse(sessionNo));
    }

    @PostMapping("/{gameCode}/sessions/{sessionNo}/complete")
    public ApiResponse<GameService.GameResult> completeSession(
            @PathVariable String gameCode,
            @PathVariable String sessionNo,
            @Valid @RequestBody CompleteSessionRequest request
    ) {
        GameService.GameResult result = gameService.completeSession(
                request.userId(),
                gameCode,
                sessionNo,
                request.score(),
                request.correctCount(),
                request.totalCount()
        );
        return ApiResponse.ok(result);
    }

    public record StartSessionRequest(
            @NotNull(message = "userId不能为空")
            Long userId
    ) {
    }

    public record CompleteSessionRequest(
            @NotNull(message = "userId不能为空")
            Long userId,
            @Min(value = 0, message = "score不能小于0")
            int score,
            @Min(value = 0, message = "correctCount不能小于0")
            int correctCount,
            @Min(value = 0, message = "totalCount不能小于0")
            @Max(value = 10000, message = "totalCount过大")
            int totalCount
    ) {
    }

    public record StartSessionResponse(String sessionNo) {
    }
}

