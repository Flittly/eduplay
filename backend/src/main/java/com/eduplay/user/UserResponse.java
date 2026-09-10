package com.eduplay.user;

public record UserResponse(
        Long id,
        String username,
        String nickname,
        String userType,
        String role,
        String studentNo,
        String className,
        String status,
        String phone,
        String email,
        String gender,
        String birthday
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
                user.getStatus(),
                user.getPhone(),
                user.getEmail(),
                user.getGender(),
                user.getBirthday() == null ? null : user.getBirthday().toString()
        );
    }
}
