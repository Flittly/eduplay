package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface ActivationCodeRepository extends JpaRepository<ActivationCode, Long> {

    Optional<ActivationCode> findByCode(String code);

    List<ActivationCode> findAllByOrderByCreatedAtDesc();

    long countByStatus(String status);

    /**
     * 原子占用激活码：只有把 UNUSED 成功翻成 USED 的请求才算兑换成功。
     *
     * <p>并发下两个请求会串行执行这条 UPDATE，后到的那个因为
     * {@code status} 已不是 UNUSED 而影响行数为 0，据此判定"已被使用"，
     * 从而避免同一激活码被双花（唯一键 {@code (user_id, game_id)} 挡不住不同用户）。
     *
     * @return 影响行数，1 = 占用成功，0 = 已被他人占用
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update ActivationCode c set c.status = 'USED',"
            + " c.usedByUserId = :userId, c.usedAt = :usedAt"
            + " where c.id = :id and c.status = 'UNUSED'")
    int markUsedIfUnused(
            @Param("id") Long id,
            @Param("userId") Long userId,
            @Param("usedAt") Instant usedAt
    );
}
