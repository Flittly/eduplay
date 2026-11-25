package com.eduplay.health;

import com.eduplay.common.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 本地后端的存活探针。
 *
 * <p>桌面壳用 {@code fetch(...).ok} 判断后端「起来了没有」（见 desktop/main.js 的
 * {@code waitForBackend}）。原来的实现不看数据库，只要 Tomcat 在监听就返回
 * {@code 200 + UP} —— 数据库文件损坏、被另一个进程独占、迁移失败时，
 * 壳子会认为"后端已就绪"，直接把窗口切到首页，随后每个接口都 500。
 *
 * <p>现在探针会真的执行一次 {@code select 1}：数据库不可用时返回 **503**，
 * 壳子会继续等待并最终提示看日志，而不是把一个半死状态当成正常。
 */
@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> health() {
        boolean databaseUp;
        try {
            Integer probe = jdbcTemplate.queryForObject("select 1", Integer.class);
            databaseUp = probe != null && probe == 1;
        } catch (Exception ex) {
            // 探针本身不该把异常抛出去：它要返回的是"不健康"，不是一个 500
            log.warn("健康检查：数据库探针失败：{}", ex.getMessage());
            databaseUp = false;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", databaseUp ? "UP" : "DOWN");
        body.put("database", databaseUp ? "UP" : "DOWN");
        body.put("time", Instant.now().toString());

        return ResponseEntity
                .status(databaseUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResponse.ok(body));
    }
}
