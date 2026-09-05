package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GameTagRepository extends JpaRepository<GameTag, Long> {

    List<GameTag> findByStatusOrderByCategoryAscSortOrderAscIdAsc(String status);

    Optional<GameTag> findByCode(String code);

    boolean existsByCode(String code);
}
