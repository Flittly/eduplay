package com.eduplay.auth;

import com.eduplay.common.ApiResponse;
import com.eduplay.user.UserResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/local/register")
    public ApiResponse<AuthService.LoginResult> registerLocal(
            @Valid @RequestBody RegisterRequest request
    ) {
        AuthService.RegisterLocalRequest serviceRequest = new AuthService.RegisterLocalRequest(
                request.username(),
                request.password(),
                request.nickname(),
                request.role(),
                request.studentNo(),
                request.className(),
                request.phone(),
                request.email(),
                request.gender(),
                request.birthday()
        );
        return ApiResponse.ok(authService.registerLocal(serviceRequest));
    }

    @PutMapping("/profile")
    public ApiResponse<UserResponse> updateProfile(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody UpdateProfileRequest request
    ) {
        AuthService.UpdateProfileRequest serviceRequest =
                new AuthService.UpdateProfileRequest(
                        request.nickname(),
                        request.phone(),
                        request.email(),
                        request.gender(),
                        request.birthday()
                );
        return ApiResponse.ok(authService.updateProfile(authorization, serviceRequest));
    }

    @PostMapping("/local/login")
    public ApiResponse<AuthService.LoginResult> loginLocal(
            @Valid @RequestBody LoginRequest request
    ) {
        AuthService.LoginLocalRequest serviceRequest =
                new AuthService.LoginLocalRequest(request.username(), request.password());
        return ApiResponse.ok(authService.loginLocal(serviceRequest));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        authService.logout(authorization);
        return ApiResponse.ok();
    }

    @GetMapping("/me")
    public ApiResponse<UserResponse> me(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(authService.getCurrentUser(authorization));
    }

    public record RegisterRequest(
            @NotBlank(message = "用户名不能为空")
            @Size(min = 3, max = 64, message = "用户名长度应为3到64位")
            String username,
            @NotBlank(message = "密码不能为空")
            @Size(min = 6, max = 64, message = "密码长度应为6到64位")
            String password,
            @Size(max = 64, message = "昵称不能超过64位")
            String nickname,
            String role,
            @Size(max = 64, message = "学号不能超过64位")
            String studentNo,
            @Size(max = 64, message = "班级不能超过64位")
            String className,
            @Size(max = 32, message = "电话号码不能超过32位")
            String phone,
            @Size(max = 128, message = "邮箱不能超过128位")
            String email,
            @Size(max = 16, message = "性别取值不合法")
            String gender,
            @Size(max = 10, message = "生日格式应为 yyyy-MM-dd")
            String birthday
    ) {
    }

    public record UpdateProfileRequest(
            @Size(max = 64, message = "昵称不能超过64位")
            String nickname,
            @Size(max = 32, message = "电话号码不能超过32位")
            String phone,
            @Size(max = 128, message = "邮箱不能超过128位")
            String email,
            @Size(max = 16, message = "性别取值不合法")
            String gender,
            @Size(max = 10, message = "生日格式应为 yyyy-MM-dd")
            String birthday
    ) {
    }

    public record LoginRequest(
            @NotBlank(message = "用户名不能为空")
            String username,
            @NotBlank(message = "密码不能为空")
            String password
    ) {
    }
}
