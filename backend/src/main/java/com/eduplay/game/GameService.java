package com.eduplay.game;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.points.PointsService;
import com.eduplay.user.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class GameService {

    private final GameProductRepository gameProductRepository;
    private final GameSessionRepository gameSessionRepository;
    private final UserService userService;
    private final PointsService pointsService;

    public GameService(
            GameProductRepository gameProductRepository,
            GameSessionRepository gameSessionRepository,
            UserService userService,
            PointsService pointsService
    ) {
        this.gameProductRepository = gameProductRepository;
        this.gameSessionRepository = gameSessionRepository;
        this.userService = userService;
        this.pointsService = pointsService;
    }

    @Transactional(readOnly = true)
    public List<GameProduct> listActiveGames() {
        return gameProductRepository.findByStatusOrderByIdAsc("ACTIVE");
    }

    @Transactional(readOnly = true)
    public GameProduct getByGameCode(String gameCode) {
        return gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new NotFoundException("游戏不存在: " + gameCode));
    }

    @Transactional
    public String startSession(Long userId, String gameCode) {
        userService.getById(userId);
        GameProduct game = getByGameCode(gameCode);

        GameSession session = new GameSession();
        session.setUserId(userId);
        session.setGameId(game.getId());
        session.setSessionNo(UUID.randomUUID().toString());
        session.setScore(0);
        session.setCorrectCount(0);
        session.setTotalCount(0);
        session.setStatus("PLAYING");
        session.setClientVersion("0.1.0");
        session.setStartedAt(Instant.now());
        return gameSessionRepository.save(session).getSessionNo();
    }

    @Transactional
    public GameResult completeSession(
            Long userId,
            String gameCode,
            String sessionNo,
            int score,
            int correctCount,
            int totalCount
    ) {
        GameSession session = gameSessionRepository.findBySessionNo(sessionNo)
                .orElseThrow(() -> new NotFoundException("游戏会话不存在: " + sessionNo));

        if (!session.getUserId().equals(userId)) {
            throw new BusinessException("SESSION_USER_MISMATCH", "游戏会话不属于当前用户");
        }
        if (!"PLAYING".equals(session.getStatus())) {
            throw new BusinessException("SESSION_ALREADY_FINISHED", "游戏会话已经结束");
        }

        GameProduct game = getByGameCode(gameCode);
        if (!session.getGameId().equals(game.getId())) {
            throw new BusinessException("SESSION_GAME_MISMATCH", "游戏会话与游戏不匹配");
        }

        session.setScore(score);
        session.setCorrectCount(correctCount);
        session.setTotalCount(totalCount);
        session.setStatus("FINISHED");
        session.setFinishedAt(Instant.now());
        gameSessionRepository.save(session);

        int awardedPoints = Math.max(score, 0);
        int balance = pointsService.awardPoints(
                userId,
                awardedPoints,
                "GAME_COMPLETE",
                sessionNo,
                "session:" + sessionNo
        );

        return new GameResult(sessionNo, awardedPoints, balance);
    }

    public record GameResult(
            String sessionNo,
            int pointsAwarded,
            int balance
    ) {
    }
}

