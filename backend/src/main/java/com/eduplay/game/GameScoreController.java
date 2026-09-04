package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/games")
@Profile("local")
public class GameScoreController {

    private final GameScoreService gameScoreService;

    public GameScoreController(GameScoreService gameScoreService) {
        this.gameScoreService = gameScoreService;
    }

    @PostMapping("/{gameCode}/scores")
    public ApiResponse<GameScoreService.GameScoreResponse> submitScore(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable String gameCode,
            @Valid @RequestBody SubmitScoreRequest request
    ) {
        GameScoreService.SubmitScoreRequest serviceRequest =
                new GameScoreService.SubmitScoreRequest(
                        request.studentId(),
                        request.score(),
                        request.roundId()
                );
        return ApiResponse.ok(gameScoreService.submitScore(
                authorization,
                gameCode,
                serviceRequest
        ));
    }

    public record SubmitScoreRequest(
            @NotNull(message = "学生不能为空")
            Long studentId,
            @Min(value = 0, message = "游戏积分不能小于0")
            @Max(value = 99999, message = "游戏积分不能超过99999")
            int score,
            @NotBlank(message = "游戏回合标识不能为空")
            @Size(max = 64, message = "游戏回合标识不能超过64位")
            String roundId
    ) {
    }
}
