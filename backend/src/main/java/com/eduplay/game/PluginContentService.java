package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;
import org.springframework.context.annotation.Profile;

@Service
@Profile("local")
public class PluginContentService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final UserGameInstallRepository installRepository;
    private final PluginPackageService pluginPackageService;

    public PluginContentService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserGameInstallRepository installRepository,
            PluginPackageService pluginPackageService
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.installRepository = installRepository;
        this.pluginPackageService = pluginPackageService;
    }

    @Transactional(readOnly = true)
    public PluginFile serveFile(
            String token,
            String gameCode,
            String version,
            String relativePath
    ) {
        AppUser user = authService.requireUserByToken(token);
        GameProduct game = gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));

        UserGameInstall install = installRepository.findByUserIdAndGameId(user.getId(), game.getId())
                .orElseThrow(() -> new BusinessException("GAME_NOT_INSTALLED", "游戏未安装"));

        if (!Objects.equals(install.getInstalledVersion(), version)) {
            throw new BusinessException("PLUGIN_VERSION_MISMATCH", "插件版本不匹配");
        }

        String normalizedPath = normalizeRelativePath(relativePath);
        Path file = pluginPackageService.resolveInstalledFile(
                user.getId(),
                gameCode,
                install.getInstalledVersion(),
                normalizedPath
        );

        return new PluginFile(
                file,
                mediaTypeFor(file.getFileName().toString())
        );
    }

    private String normalizeRelativePath(String relativePath) {
        String path = relativePath == null ? "" : relativePath.trim();
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isBlank()) {
            return "manifest.json";
        }
        return path;
    }

    private String mediaTypeFor(String fileName) {
        String name = fileName.toLowerCase(Locale.ROOT);
        if (name.endsWith(".html") || name.endsWith(".htm")) {
            return "text/html";
        }
        if (name.endsWith(".js") || name.endsWith(".mjs")) {
            return "application/javascript";
        }
        if (name.endsWith(".css")) {
            return "text/css";
        }
        if (name.endsWith(".json")) {
            return "application/json";
        }
        if (name.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (name.endsWith(".gif")) {
            return "image/gif";
        }
        if (name.endsWith(".webp")) {
            return "image/webp";
        }
        if (name.endsWith(".ico")) {
            return "image/x-icon";
        }
        if (name.endsWith(".woff")) {
            return "font/woff";
        }
        if (name.endsWith(".woff2")) {
            return "font/woff2";
        }
        return "application/octet-stream";
    }

    public record PluginFile(
            Path path,
            String mediaType
    ) {
    }
}
