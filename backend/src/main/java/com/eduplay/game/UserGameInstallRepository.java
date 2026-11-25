package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface UserGameInstallRepository extends JpaRepository<UserGameInstall, Long> {

    List<UserGameInstall> findByUserId(Long userId);

    Optional<UserGameInstall> findByUserIdAndGameId(Long userId, Long gameId);

    long countByGameId(Long gameId);

    /** 一次查出每个游戏的安装数，替代列表页里逐行 countByGameId。 */
    @Query("select i.gameId, count(i) from UserGameInstall i group by i.gameId")
    List<Object[]> countGroupByGameId();
}
