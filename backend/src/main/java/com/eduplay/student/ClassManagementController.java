package com.eduplay.student;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/classes")
@Profile("local")
public class ClassManagementController {

    private final ClassManagementService classService;

    public ClassManagementController(ClassManagementService classService) {
        this.classService = classService;
    }

    @GetMapping
    public ApiResponse<List<ClassManagementService.ClassSummary>> list(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(classService.listClasses(authorization));
    }

    @PutMapping("/monitor")
    public ApiResponse<ClassManagementService.ClassSummary> setMonitor(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody MonitorRequest request
    ) {
        return ApiResponse.ok(classService.setMonitor(
                authorization,
                request.className(),
                request.monitorName()
        ));
    }

    @DeleteMapping
    public ApiResponse<Void> delete(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam String className
    ) {
        classService.deleteClass(authorization, className);
        return ApiResponse.ok();
    }

    public record MonitorRequest(
            @NotBlank(message = "班级不能为空")
            @Size(max = 64, message = "班级不能超过64位")
            String className,
            @Size(max = 64, message = "课代表姓名不能超过64位")
            String monitorName
    ) {
    }
}
