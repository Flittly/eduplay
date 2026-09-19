package com.eduplay.admin;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/teachers")
public class AdminTeacherController {

    private final AdminTeacherService teacherService;

    public AdminTeacherController(AdminTeacherService teacherService) {
        this.teacherService = teacherService;
    }

    @GetMapping
    public ApiResponse<List<AdminTeacherService.TeacherResponse>> list(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(value = "keyword", required = false) String keyword
    ) {
        return ApiResponse.ok(teacherService.listTeachers(authorization, keyword));
    }

    @PatchMapping("/{teacherId}/status")
    public ApiResponse<AdminTeacherService.TeacherResponse> updateStatus(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long teacherId,
            @Valid @RequestBody StatusRequest request
    ) {
        return ApiResponse.ok(teacherService.updateStatus(
                authorization,
                teacherId,
                request.status()
        ));
    }

    @PostMapping("/{teacherId}/reset-password")
    public ApiResponse<AdminTeacherService.TeacherResponse> resetPassword(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long teacherId,
            @Valid @RequestBody ResetPasswordRequest request
    ) {
        return ApiResponse.ok(teacherService.resetPassword(
                authorization,
                teacherId,
                request.newPassword()
        ));
    }

    public record StatusRequest(
            @NotBlank(message = "状态不能为空")
            String status
    ) {
    }

    public record ResetPasswordRequest(
            @NotBlank(message = "新密码不能为空")
            @Size(min = 6, max = 64, message = "新密码长度应为6到64位")
            String newPassword
    ) {
    }
}
