package com.eduplay.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {

    Optional<AppUser> findByUsername(String username);

    boolean existsByUsername(String username);

    boolean existsByStudentNo(String studentNo);

    List<AppUser> findByRoleOrderByCreatedAtDesc(String role);

    long countByRole(String role);

    long countByRoleAndStatus(String role, String status);
}
