package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface GameProductTagRepository extends JpaRepository<GameProductTag, Long> {

    List<GameProductTag> findByGameId(Long gameId);

    List<GameProductTag> findByGameIdIn(Collection<Long> gameIds);

    void deleteByGameId(Long gameId);
}
