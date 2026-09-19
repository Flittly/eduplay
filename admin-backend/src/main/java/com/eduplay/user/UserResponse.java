package com.eduplay.user;

public record UserResponse(
        Long id,
        String username,
        String nickname,
        String userType,
        String role,
        String studentNo,
        String className,
        String status
) {
    public static UserResponse from(AppUser user) {
        return new UserResponse(
                user.getId(),
                user.getUsername(),
                user.getNickname(),
                user.getUserType(),
                user.getRole(),
                user.getStudentNo(),
                user.getClassName(),
                user.getStatus()
        );
    }
}
