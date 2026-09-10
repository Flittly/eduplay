package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface GamePackageRepository extends JpaRepository<GamePackage, Long> {

    Optional<GamePackage> findByGameIdAndVersion(Long gameId, String version);

    Optional<GamePackage> findFirstByGameIdOrderByVersionDesc(Long gameId);

    List<GamePackage> findByGameIdOrderByVersionDesc(Long gameId);

    boolean existsByGameIdAndVersion(Long gameId, String version);

    /**
     * 批量取每个游戏的最新版本，用于消除列表接口的 N+1 查询。
     * 语义与逐个调用 {@link #findFirstByGameIdOrderByVersionDesc(Long)} 完全一致
     * （同为 version 字符串的最大值），仅把 N 次查询收敛为 1 次。
     */
    @Query("select p from GamePackage p where p.gameId in :gameIds "
            + "and p.version = (select max(p2.version) from GamePackage p2 where p2.gameId = p.gameId)")
    List<GamePackage> findLatestVersions(@Param("gameIds") Collection<Long> gameIds);
}
