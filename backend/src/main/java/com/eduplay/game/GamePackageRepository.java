package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GamePackageRepository extends JpaRepository<GamePackage, Long> {

    Optional<GamePackage> findByGameIdAndVersion(Long gameId, String version);

    Optional<GamePackage> findFirstByGameIdOrderByVersionDesc(Long gameId);

    List<GamePackage> findByGameIdOrderByVersionDesc(Long gameId);
}

