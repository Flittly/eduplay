package com.eduplay.points;

import com.eduplay.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class PointsController {

    private final PointsService pointsService;

    public PointsController(PointsService pointsService) {
        this.pointsService = pointsService;
    }

    @GetMapping("/users/{userId}/points")
    public ApiResponse<PointsService.PointsSummary> getPoints(@PathVariable Long userId) {
        return ApiResponse.ok(pointsService.getSummary(userId));
    }
}

