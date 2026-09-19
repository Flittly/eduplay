package com.eduplay.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

public interface LocalSessionRepository extends JpaRepository<LocalSession, Long> {

    Optional<LocalSession> findByToken(String token);

    void deleteByToken(String token);

    void deleteByExpiresAtBefore(Instant expiresAt);
}

