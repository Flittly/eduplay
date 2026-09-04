package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.student.Student;
import com.eduplay.student.StudentPointsLedger;
import com.eduplay.student.StudentPointsLedgerRepository;
import com.eduplay.student.StudentRepository;
import com.eduplay.user.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class GameScoreService {

    private static final int MAX_SCORE = 99999;

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final StudentRepository studentRepository;
    private final StudentPointsLedgerRepository ledgerRepository;

    public GameScoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            StudentRepository studentRepository,
            StudentPointsLedgerRepository ledgerRepository
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.studentRepository = studentRepository;
        this.ledgerRepository = ledgerRepository;
    }

    @Transactional
    public GameScoreResponse submitScore(
            String authorizationHeader,
            String gameCode,
            SubmitScoreRequest request
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));

        int score = request.score();
        if (score < 0 || score > MAX_SCORE) {
            throw new BusinessException("INVALID_SCORE", "本次游戏积分应在0到99999之间");
        }

        Student student = studentRepository.findByIdAndTeacherId(
                        request.studentId(),
                        teacher.getId()
                )
                .orElseThrow(() -> new NotFoundException("学生不存在或不属于当前教师"));

        String roundId = request.roundId() == null
                ? UUID.randomUUID().toString()
                : request.roundId().trim();
        if (roundId.isBlank() || roundId.length() > 64) {
            throw new BusinessException("INVALID_ROUND_ID", "游戏回合标识不合法");
        }

        boolean recorded = false;
        if (score > 0) {
            String idempotencyKey = buildIdempotencyKey(game.getGameCode(), student.getId(), roundId);
            if (!ledgerRepository.existsByIdempotencyKey(idempotencyKey)) {
                int balanceAfter = student.getTotalPoints() + score;
                student.setTotalPoints(balanceAfter);
                studentRepository.saveAndFlush(student);

                StudentPointsLedger ledger = new StudentPointsLedger();
                ledger.setStudentId(student.getId());
                ledger.setTeacherId(teacher.getId());
                ledger.setChangeType("GAME_EARN");
                ledger.setAmount(score);
                ledger.setBalanceAfter(balanceAfter);
                ledger.setBizType("GAME_SCORE");
                ledger.setBizId(roundId);
                ledger.setIdempotencyKey(idempotencyKey);
                ledgerRepository.save(ledger);
                recorded = true;
            }
        }

        return new GameScoreResponse(
                student.getId(),
                student.getName(),
                student.getStudentNo(),
                student.getClassName(),
                student.getTotalPoints(),
                score,
                recorded
        );
    }

    private String buildIdempotencyKey(String gameCode, Long studentId, String roundId) {
        String raw = gameCode + ":" + studentId + ":" + roundId;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String hex = HexFormat.of().formatHex(
                    digest.digest(raw.getBytes(StandardCharsets.UTF_8))
            );
            return "g:" + hex.substring(0, 62);
        } catch (NoSuchAlgorithmException ex) {
            throw new BusinessException("HASH_FAILED", "积分结算标识生成失败");
        }
    }

    private AppUser requireTeacher(String authorizationHeader) {
        AppUser user = authService.requireUser(authorizationHeader);
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以结算游戏积分");
        }
        return user;
    }

    public record SubmitScoreRequest(
            Long studentId,
            int score,
            String roundId
    ) {
    }

    public record GameScoreResponse(
            Long id,
            String name,
            String studentNo,
            String className,
            int totalPoints,
            int score,
            boolean recorded
    ) {
    }
}
