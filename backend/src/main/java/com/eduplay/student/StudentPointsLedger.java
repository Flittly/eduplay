package com.eduplay.student;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "student_points_ledger")
@Getter
@Setter
@NoArgsConstructor
public class StudentPointsLedger {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "student_id", nullable = false)
    private Long studentId;

    @Column(name = "teacher_id", nullable = false)
    private Long teacherId;

    @Column(name = "change_type", nullable = false, length = 32)
    private String changeType;

    @Column(nullable = false)
    private Integer amount;

    @Column(name = "balance_after", nullable = false)
    private Integer balanceAfter;

    @Column(name = "biz_type", nullable = false, length = 32)
    private String bizType;

    @Column(name = "biz_id", nullable = false, length = 64)
    private String bizId;

    @Column(name = "idempotency_key", nullable = false, unique = true, length = 64)
    private String idempotencyKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}

