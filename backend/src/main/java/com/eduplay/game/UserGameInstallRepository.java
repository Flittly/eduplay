package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserGameInstallRepository extends JpaRepository<UserGameInstall, Long> {

    List<UserGameInstall> findByUserId(Long userId);

    Optional<UserGameInstall> findByUserIdAndGameId(Long userId, Long gameId);

    long countByGameId(Long gameId);
}
