package com.eduplay.student;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StudentPointsLedgerRepository
        extends JpaRepository<StudentPointsLedger, Long> {

    List<StudentPointsLedger> findByStudentIdOrderByCreatedAtDesc(Long studentId);

    void deleteByStudentId(Long studentId);

    boolean existsByIdempotencyKey(String idempotencyKey);
}
