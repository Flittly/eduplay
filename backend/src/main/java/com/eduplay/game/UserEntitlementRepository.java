package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface UserEntitlementRepository extends JpaRepository<UserEntitlement, Long> {

    List<UserEntitlement> findByUserIdAndStatus(Long userId, String status);

    Optional<UserEntitlement> findByUserIdAndGameId(Long userId, Long gameId);

    long countByGameId(Long gameId);

    /** 一次查出每个游戏的权益数，替代列表页里逐行 countByGameId。 */
    @Query("select e.gameId, count(e) from UserEntitlement e group by e.gameId")
    List<Object[]> countGroupByGameId();
}
