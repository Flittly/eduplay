package com.eduplay.game;

import com.eduplay.auth.AuthContext;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;

@Service
@Profile("local")
public class PluginContentService {

    private final PluginPlayTicketService ticketService;
    private final GameProductRepository gameProductRepository;
    private final UserGameInstallRepository installRepository;
    private final PluginPackageService pluginPackageService;

    public PluginContentService(
            PluginPlayTicketService ticketService,
            GameProductRepository gameProductRepository,
            UserGameInstallRepository installRepository,
            PluginPackageService pluginPackageService
    ) {
        this.ticketService = ticketService;
        this.gameProductRepository = gameProductRepository;
        this.installRepository = installRepository;
        this.pluginPackageService = pluginPackageService;
    }

    /**
     * 给当前登录教师签发一张「进入这个游戏」的短期票据。
     *
     * <p>这条路要求登录（走 {@code Authorization} 头），签出来的票据才给 iframe 用。
     * 在这里校验"已安装"是刻意的：没装的游戏连票据都拿不到，
     * 不必等到每个静态资源请求时才拒绝。
     */
    @Transactional(readOnly = true)
    public PluginPlayTicketService.IssuedTicket issueTicket(String gameCode, String version) {
        AppUser user = AuthContext.requireUser();
        GameProduct game = gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));
        UserGameInstall install = installRepository
                .findByUserIdAndGameId(user.getId(), game.getId())
                .orElseThrow(() -> new BusinessException("GAME_NOT_INSTALLED", "游戏未安装"));
        if (!Objects.equals(install.getInstalledVersion(), version)) {
            throw new BusinessException("PLUGIN_VERSION_MISMATCH", "游戏版本已更新，请重新进入");
        }
        return ticketService.issue(user.getId(), gameCode, version);
    }

    /**
     * 解析一个插件资源文件。
     *
     * <p>每个请求只查两次库（游戏 + 安装记录），身份来自票据本身。
     * 改造前这里是四次：会话、用户、游戏、安装 ——
     * 一次开游戏 80~160 个资源请求，就是 300~600 次查询。
     */
    @Transactional(readOnly = true)
    public PluginFile serveFile(
            String token,
            String gameCode,
            String version,
            String relativePath
    ) {
        Long userId = ticketService.require(token, gameCode, version);
        GameProduct game = gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));

        UserGameInstall install = installRepository.findByUserIdAndGameId(userId, game.getId())
                .orElseThrow(() -> new BusinessException("GAME_NOT_INSTALLED", "游戏未安装"));

        if (!Objects.equals(install.getInstalledVersion(), version)) {
            throw new BusinessException("PLUGIN_VERSION_MISMATCH", "插件版本不匹配");
        }

        String normalizedPath = normalizeRelativePath(relativePath);
        Path file = pluginPackageService.resolveInstalledFile(
                userId,
                gameCode,
                version,
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
