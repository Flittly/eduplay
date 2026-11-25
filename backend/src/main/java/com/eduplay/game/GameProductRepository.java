package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface GameProductRepository extends JpaRepository<GameProduct, Long> {

    Optional<GameProduct> findByGameCode(String gameCode);

    List<GameProduct> findByStatusOrderByIdAsc(String status);

    /** 积分流水里出现的 gameCode 一次性映射成游戏名（替代逐个 findByGameCode）。 */
    List<GameProduct> findByGameCodeIn(Collection<String> gameCodes);
}

