package com.eduplay.admin;

import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminBootstrapRunner implements ApplicationRunner {

    private final AppUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrapRunner(
            AppUserRepository userRepository,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (userRepository.existsByUsername("admin")) {
            return;
        }

        AppUser admin = new AppUser();
        admin.setUsername("admin");
        admin.setNickname("超级管理员");
        admin.setUserType("ADMIN");
        admin.setRole("SUPER_ADMIN");
        admin.setStatus("ACTIVE");
        admin.setPasswordHash(passwordEncoder.encode("admin123"));
        userRepository.save(admin);
    }
}

