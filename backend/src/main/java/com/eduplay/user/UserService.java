package com.eduplay.user;

import com.eduplay.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class UserService {

    private final AppUserRepository userRepository;

    public UserService(AppUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public AppUser createGuest(String nickname) {
        AppUser user = new AppUser();
        user.setUsername("guest_" + UUID.randomUUID().toString().substring(0, 8));
        user.setNickname(nickname == null || nickname.isBlank() ? "游客" : nickname.trim());
        user.setUserType("GUEST");
        return userRepository.save(user);
    }

    @Transactional(readOnly = true)
    public AppUser getById(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("用户不存在: " + userId));
    }
}

