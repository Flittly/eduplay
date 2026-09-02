package com.eduplay.user;

import com.eduplay.common.ApiResponse;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/guest")
    public ApiResponse<UserResponse> createGuest(
            @RequestBody(required = false) GuestCreateRequest request
    ) {
        String nickname = request == null ? null : request.nickname();
        AppUser user = userService.createGuest(nickname);
        return ApiResponse.ok(UserResponse.from(user));
    }

    public record GuestCreateRequest(
            @Size(max = 64, message = "昵称不能超过64个字符")
            String nickname
    ) {
    }
}

