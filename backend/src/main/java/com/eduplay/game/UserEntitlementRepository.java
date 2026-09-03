package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserEntitlementRepository extends JpaRepository<UserEntitlement, Long> {

    List<UserEntitlement> findByUserIdAndStatus(Long userId, String status);

    Optional<UserEntitlement> findByUserIdAndGameId(Long userId, Long gameId);
}

