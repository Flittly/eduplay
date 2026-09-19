package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GameProductRepository extends JpaRepository<GameProduct, Long> {

    Optional<GameProduct> findByGameCode(String gameCode);

    List<GameProduct> findByStatusOrderByIdAsc(String status);
}

