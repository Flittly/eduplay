package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ActivationCodeRepository extends JpaRepository<ActivationCode, Long> {

    Optional<ActivationCode> findByCode(String code);

    List<ActivationCode> findAllByOrderByCreatedAtDesc();

    long countByStatus(String status);
}
