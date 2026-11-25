package com.eduplay.admin;

import com.eduplay.user.AppUser;
import com.eduplay.user.AppUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminBootstrapRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapRunner.class);

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

        // 首次启动只在本机建一个管理账号。密码可用 EDUPLAY_ADMIN_PASSWORD 覆盖；
        // 不设则沿用历史默认值，但打一条明确的告警 —— 之所以敢留默认值，
        // 是因为 server.address 已固定为 127.0.0.1（见 application.yml），
        // 这条口令只可能被本机进程用到。若有人把绑定地址改成 0.0.0.0，
        // 下面这条日志就是唯一的提示。
        String password = System.getenv("EDUPLAY_ADMIN_PASSWORD");
        boolean usingDefault = password == null || password.isBlank();
        if (usingDefault) {
            password = "admin123";
        }

        AppUser admin = new AppUser();
        admin.setUsername("admin");
        admin.setNickname("超级管理员");
        admin.setUserType("ADMIN");
        admin.setRole("SUPER_ADMIN");
        admin.setStatus("ACTIVE");
        admin.setPasswordHash(passwordEncoder.encode(password));
        userRepository.save(admin);

        if (usingDefault) {
            log.warn("已创建默认管理员账号 admin / admin123。"
                    + "若把 server.address 改成 0.0.0.0，必须先用环境变量 "
                    + "EDUPLAY_ADMIN_PASSWORD 指定一个强口令并删除该账号。");
        } else {
            log.info("已用 EDUPLAY_ADMIN_PASSWORD 指定的口令创建管理员账号 admin。");
        }
    }
}

