package com.eduplay.student;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface StudentPointsLedgerRepository
        extends JpaRepository<StudentPointsLedger, Long> {

    List<StudentPointsLedger> findByStudentIdOrderByCreatedAtDesc(Long studentId);

    void deleteByStudentId(Long studentId);

    /** 删除班级时一次性清掉整批学生的流水（原先是逐个 deleteByStudentId）。 */
    void deleteByStudentIdIn(Collection<Long> studentIds);

    boolean existsByIdempotencyKey(String idempotencyKey);
}
