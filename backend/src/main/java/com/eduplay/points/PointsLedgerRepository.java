package com.eduplay.points;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PointsLedgerRepository extends JpaRepository<PointsLedger, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);
}

