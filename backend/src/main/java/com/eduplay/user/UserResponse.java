package com.eduplay.user;

public record UserResponse(
        Long id,
        String username,
        String nickname,
        String userType
) {
    public static UserResponse from(AppUser user) {
        return new UserResponse(
                user.getId(),
                user.getUsername(),
                user.getNickname(),
                user.getUserType()
        );
    }
}

