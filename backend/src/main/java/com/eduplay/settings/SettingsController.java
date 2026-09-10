package com.eduplay.settings;

import com.eduplay.auth.AuthService;
import com.eduplay.common.ApiResponse;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/settings")
public class SettingsController {

    private final AuthService authService;
    private final SettingsService settingsService;
    private final String platformVersion;
    private final String serverPort;
    private final String dataSourceUrl;

    public SettingsController(
            AuthService authService,
            SettingsService settingsService,
            @Value("${eduplay.version:unknown}") String platformVersion,
            @Value("${server.port:8080}") String serverPort,
            @Value("${spring.datasource.url:}") String dataSourceUrl
    ) {
        this.authService = authService;
        this.settingsService = settingsService;
        this.platformVersion = platformVersion;
        this.serverPort = serverPort;
        this.dataSourceUrl = dataSourceUrl;
    }

    @GetMapping
    public ApiResponse<PlatformSettingsResponse> getSettings(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        authService.requireUser(authorization);
        return ApiResponse.ok(buildResponse());
    }

    @PutMapping("/plugin-dir")
    public ApiResponse<PlatformSettingsResponse> updatePluginDir(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody UpdatePluginDirRequest request
    ) {
        AppUser user = authService.requireUser(authorization);
        if (!Set.of("TEACHER", "SUPER_ADMIN").contains(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师可以修改游戏安装目录");
        }
        settingsService.changePluginInstallDir(request.path());
        return ApiResponse.ok(buildResponse());
    }

    @PutMapping("/cloud-url")
    public ApiResponse<PlatformSettingsResponse> updateCloudUrl(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody UpdateCloudUrlRequest request
    ) {
        AppUser user = authService.requireUser(authorization);
        if (!Set.of("TEACHER", "SUPER_ADMIN").contains(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师可以修改云端服务地址");
        }
        settingsService.changeCloudBaseUrl(request.url());
        return ApiResponse.ok(buildResponse());
    }

    private PlatformSettingsResponse buildResponse() {
        String dbPath = dataSourceUrl;
        if (dbPath.startsWith("jdbc:h2:file:")) {
            dbPath = dbPath.substring("jdbc:h2:file:".length());
            int semicolon = dbPath.indexOf(';');
            if (semicolon >= 0) {
                dbPath = dbPath.substring(0, semicolon);
            }
        }
        return new PlatformSettingsResponse(
                platformVersion,
                settingsService.getPluginInstallDir().toString(),
                serverPort,
                dbPath,
                settingsService.getCloudBaseUrl()
        );
    }

    public record PlatformSettingsResponse(
            String version,
            String pluginInstallDir,
            String serverPort,
            String databasePath,
            String cloudBaseUrl
    ) {
    }

    public record UpdatePluginDirRequest(
            @NotBlank(message = "安装目录不能为空")
            String path
    ) {
    }

    public record UpdateCloudUrlRequest(
            @NotBlank(message = "云端地址不能为空")
            String url
    ) {
    }
}
