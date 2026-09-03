package com.eduplay.admin;

import com.eduplay.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminStatsController {

    private final AdminStatsService statsService;

    public AdminStatsController(AdminStatsService statsService) {
        this.statsService = statsService;
    }

    @GetMapping("/stats")
    public ApiResponse<AdminStatsService.StatsResponse> stats(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(statsService.stats(authorization));
    }
}
