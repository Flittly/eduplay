package com.eduplay.settings;

import com.eduplay.common.BusinessException;
import java.io.IOException;
import java.net.URI;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 平台运行时设置（存于 app_settings 表）。
 * 读取频率高的设置用 volatile 缓存，避免每次请求都查库。
 */
@Service
public class SettingsService {

    public static final String KEY_PLUGIN_INSTALL_DIR = "plugins.install-dir";
    public static final String KEY_CLOUD_BASE_URL = "cloud.base-url";

    private final AppSettingsRepository repository;
    private final Path defaultInstallDir;
    private final String defaultCloudBaseUrl;
    private volatile Path cachedInstallDir;
    private volatile String cachedCloudBaseUrl;

    public SettingsService(
            AppSettingsRepository repository,
            @Value("${eduplay.plugins.install-dir}") String defaultInstallDir,
            @Value("${eduplay.cloud.base-url:http://localhost:17070}") String defaultCloudBaseUrl
    ) {
        this.repository = repository;
        this.defaultInstallDir = Path.of(defaultInstallDir).toAbsolutePath().normalize();
        this.defaultCloudBaseUrl = defaultCloudBaseUrl;
    }

    public Path getPluginInstallDir() {
        Path cached = cachedInstallDir;
        if (cached != null) {
            return cached;
        }
        Path resolved = repository.findById(KEY_PLUGIN_INSTALL_DIR)
                .map(item -> Path.of(item.getSettingValue()).toAbsolutePath().normalize())
                .orElse(defaultInstallDir);
        cachedInstallDir = resolved;
        return resolved;
    }

    /**
     * 修改插件安装目录：校验并创建新目录，把旧目录下已安装的游戏整体迁移过去。
     */
    @Transactional
    public Path changePluginInstallDir(String rawDir) {
        if (rawDir == null || rawDir.isBlank()) {
            throw new BusinessException("INVALID_PATH", "安装目录不能为空");
        }
        Path oldDir = getPluginInstallDir();
        Path newDir;
        try {
            newDir = Path.of(rawDir.trim()).toAbsolutePath().normalize();
            Files.createDirectories(newDir);
            if (!Files.isWritable(newDir)) {
                throw new IOException("目录不可写");
            }
        } catch (IOException ex) {
            throw new BusinessException("INVALID_PATH", "无法创建或写入该目录：" + rawDir);
        }
        if (newDir.equals(oldDir)) {
            return newDir;
        }
        // ⚠ 互相包含必须直接拒绝：
        //   - 新目录在旧目录**里面**：moveChildren 会枚举到刚刚创建的新目录本身，
        //     然后试图把它移进它自己（newDir/newDir），必然失败且状态半残；
        //   - 旧目录在新目录里面：迁移会把父目录往子目录里搬，同样无解。
        // 这两种输入在设置页里很容易手滑（例如把路径从 D:\games 改成 D:\games\v2）。
        if (newDir.startsWith(oldDir) || oldDir.startsWith(newDir)) {
            throw new BusinessException(
                    "INVALID_PATH",
                    "新目录不能与当前目录互相包含，请选择一个独立的目录"
            );
        }

        moveChildren(oldDir, newDir);
        deleteDirIfEmpty(oldDir);

        repository.save(new AppSettings(KEY_PLUGIN_INSTALL_DIR, newDir.toString()));
        cachedInstallDir = newDir;
        return newDir;
    }

    private void moveChildren(Path oldDir, Path newDir) {
        if (!Files.isDirectory(oldDir)) {
            return;
        }
        List<Path> children;
        try (Stream<Path> stream = Files.list(oldDir)) {
            children = stream
                    // 防御：万一走到这里，也绝不把新目录自己搬进自己
                    .filter(child -> !child.toAbsolutePath().normalize().equals(newDir))
                    .toList();
        } catch (IOException ex) {
            throw new BusinessException("MOVE_FAILED", "读取旧安装目录失败");
        }

        // 先整批检查冲突再动手：原来是边遍历边移动，遇到第 3 个同名目录才失败，
        // 此时前 2 个已经搬过去了 —— 用户看到的是"迁移失败"，磁盘上却是搬了一半。
        for (Path child : children) {
            Path target = newDir.resolve(child.getFileName());
            if (Files.exists(target)) {
                throw new BusinessException(
                        "TARGET_EXISTS",
                        "目标目录已存在同名内容：" + target
                );
            }
        }

        for (Path child : children) {
            Path target = newDir.resolve(child.getFileName());
            try {
                Files.move(child, target, StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException ex) {
                throw new BusinessException(
                        "MOVE_FAILED",
                        "迁移已安装游戏失败：" + child.getFileName()
                );
            }
        }
    }

    private void deleteDirIfEmpty(Path dir) {
        try {
            Files.deleteIfExists(dir);
        } catch (DirectoryNotEmptyException ex) {
            // 旧目录还有别的内容（如 package 缓存），保留不动
        } catch (IOException ex) {
            // 删除失败不影响迁移结果
        }
    }

    /**
     * 当前云端服务地址（商城 / 激活码等请求的转发目标）。
     */
    public String getCloudBaseUrl() {
        String cached = cachedCloudBaseUrl;
        if (cached != null) {
            return cached;
        }
        String resolved = repository.findById(KEY_CLOUD_BASE_URL)
                .map(AppSettings::getSettingValue)
                .orElse(defaultCloudBaseUrl);
        cachedCloudBaseUrl = resolved;
        return resolved;
    }

    /**
     * 修改云端服务地址：支持裸 IP:端口 / 域名（自动补 http://），保存后立即生效。
     */
    @Transactional
    public String changeCloudBaseUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            throw new BusinessException("INVALID_URL", "云端地址不能为空");
        }
        String url = rawUrl.trim();
        if (!url.matches("(?i)^https?://.+")) {
            url = "http://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        try {
            URI.create(url).toURL();
        } catch (Exception ex) {
            throw new BusinessException("INVALID_URL", "云端地址格式不正确：" + rawUrl);
        }
        repository.save(new AppSettings(KEY_CLOUD_BASE_URL, url));
        cachedCloudBaseUrl = url;
        return url;
    }
}
