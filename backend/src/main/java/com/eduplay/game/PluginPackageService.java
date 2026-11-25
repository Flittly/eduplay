package com.eduplay.game;

import com.eduplay.common.BusinessException;
import com.eduplay.settings.SettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class PluginPackageService {

    private static final Logger log = LoggerFactory.getLogger(PluginPackageService.class);

    /**
     * 解压保护上限。zip 的"解压后大小"写在每个 entry 的头里，但这个值可以伪造
     * （zip bomb 的常规做法），所以这里累计的是**实际写出**的字节数。
     *
     * <p>现有最大包 7 MB、解压后约 12 MB；512 MB / 2 万个文件留了两个数量级的余量，
     * 正常插件包不可能碰到，而一个 42.zip 式的炸弹会被这里挡住。
     */
    private static final long MAX_UNCOMPRESSED_BYTES = 512L * 1024 * 1024;
    private static final int MAX_ENTRIES = 20_000;

    private final Path packageDir;
    private final SettingsService settingsService;

    public PluginPackageService(
            @Value("${eduplay.plugins.package-dir}") String packageDir,
            SettingsService settingsService
    ) {
        this.packageDir = Path.of(packageDir).toAbsolutePath().normalize();
        this.settingsService = settingsService;
    }

    /**
     * 当前插件安装目录（支持运行时在设置页修改，无需重启）。
     */
    private Path installDir() {
        return settingsService.getPluginInstallDir();
    }

    public Path resolvePackage(GamePackage gamePackage) {
        Path file = packageDir.resolve(gamePackage.getPackageName()).normalize();
        if (!file.startsWith(packageDir) || !Files.isRegularFile(file)) {
            throw new BusinessException(
                    "PACKAGE_NOT_FOUND",
                    "插件包文件不存在：" + gamePackage.getPackageName()
            );
        }
        return file;
    }

    /**
     * 先落到同目录下的临时文件，等数据库写成功后再改名（{@link #commitPackage}）。
     *
     * <p>上传的落盘顺序是「写文件 → 写数据库」，而 @Transactional 只回滚数据库：
     * 直接写正式文件名的话，写库失败时盘上已经被换成新字节、数据库却回滚到旧
     * sha256，上一版真包被顶掉且无从还原。先落临时文件就没有这个问题。
     */
    public Path stagePackage(String packageName, byte[] bytes) {
        try {
            Files.createDirectories(packageDir);
            Path target = resolvePackagePath(packageName);
            Path staging = Files.createTempFile(
                    packageDir,
                    target.getFileName() + ".",
                    ".uploading"
            );
            Files.write(staging, bytes);
            return staging;
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_SAVE_FAILED", "插件包保存失败");
        }
    }

    /** 把临时文件改成正式包名。只有数据库已经写成功才应该调它。 */
    public Path commitPackage(Path staging, String packageName) {
        try {
            Path target = resolvePackagePath(packageName);
            Files.move(staging, target, StandardCopyOption.REPLACE_EXISTING);
            return target;
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_SAVE_FAILED", "插件包保存失败");
        }
    }

    /** 上传失败时清掉临时文件。调用方已经在处理异常，这里不再往外抛。 */
    public void discardPackage(Path staging) {
        if (staging == null) {
            return;
        }
        try {
            Files.deleteIfExists(staging);
        } catch (IOException ignored) {
            // 临时文件删不掉不影响业务：它不叫正式包名，不会被下载或安装到
        }
    }

    private Path resolvePackagePath(String packageName) {
        Path file = packageDir.resolve(packageName).normalize();
        if (!file.startsWith(packageDir)) {
            throw new BusinessException("INVALID_PACKAGE_NAME", "插件包名称不合法");
        }
        return file;
    }

    public void install(Long userId, GameProduct game, GamePackage gamePackage) {
        install(userId, game, gamePackage, resolvePackage(gamePackage));
    }

    /**
     * 指定包文件安装。
     *
     * <p>上传流程里文件此时还叫临时名（尚未 commitPackage），所以不能走
     * 「按包名去 resolvePackage」那条路 —— 那样会报「插件包文件不存在」。
     *
     * <h3>为什么先解到临时目录再整体换名</h3>
     * 原先是 {@code deleteRecursively(targetRoot)} 之后才解压：解到一半磁盘满、
     * 包损坏、进程被杀，旧版本就已经没了 —— 界面上游戏还显示"已安装"，
     * 点进去全是 404，只能重装。现在解压全部在 {@code xxx.installing-<uuid>}
     * 里完成，最后一步才把旧目录挪走、把新目录改名上来；失败时旧目录原地不动。
     */
    public void install(Long userId, GameProduct game, GamePackage gamePackage, Path packageFile) {
        if (!Files.isRegularFile(packageFile)) {
            throw new BusinessException(
                    "PACKAGE_NOT_FOUND",
                    "插件包文件不存在：" + packageFile.getFileName()
            );
        }
        Path targetRoot = installedRoot(userId, game.getGameCode(), gamePackage.getVersion());
        Path parent = targetRoot.getParent();
        Path stagingRoot = parent.resolve(
                targetRoot.getFileName() + ".installing-" + UUID.randomUUID()
        );
        Path backupRoot = parent.resolve(
                targetRoot.getFileName() + ".old-" + UUID.randomUUID()
        );

        try {
            Files.createDirectories(stagingRoot);
            extract(packageFile, stagingRoot);

            Path manifest = stagingRoot.resolve("manifest.json");
            if (!Files.isRegularFile(manifest)) {
                throw new BusinessException("INVALID_PACKAGE", "插件包缺少 manifest.json");
            }

            boolean hadPrevious = Files.exists(targetRoot);
            if (hadPrevious) {
                Files.move(targetRoot, backupRoot);
            }
            try {
                Files.move(stagingRoot, targetRoot);
            } catch (IOException ex) {
                // 换名失败：把旧版放回去，界面与磁盘都不受影响
                if (hadPrevious) {
                    try {
                        Files.move(backupRoot, targetRoot);
                    } catch (IOException restoreEx) {
                        log.error("恢复旧版插件目录失败：{}", targetRoot, restoreEx);
                    }
                }
                throw ex;
            }
            if (hadPrevious) {
                deleteQuietly(backupRoot);
            }
        } catch (BusinessException ex) {
            deleteQuietly(stagingRoot);
            throw ex;
        } catch (IOException ex) {
            deleteQuietly(stagingRoot);
            throw new BusinessException("PACKAGE_INSTALL_FAILED", "插件解压失败");
        }
    }

    /**
     * 解压到指定目录，带路径穿越与体积保护。
     */
    private void extract(Path packageFile, Path root) throws IOException {
        long totalBytes = 0;
        int entryCount = 0;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(packageFile))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entryCount++;
                if (entryCount > MAX_ENTRIES) {
                    throw new BusinessException(
                            "INVALID_PACKAGE",
                            "插件包文件数量异常（超过 " + MAX_ENTRIES + " 个）"
                    );
                }
                Path target = root.resolve(entry.getName()).normalize();
                if (!target.startsWith(root)) {
                    throw new BusinessException("INVALID_PACKAGE", "插件包包含非法路径");
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                } else {
                    Files.createDirectories(target.getParent());
                    totalBytes += Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
                    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
                        throw new BusinessException(
                                "INVALID_PACKAGE",
                                "插件包解压后体积异常（超过 "
                                        + (MAX_UNCOMPRESSED_BYTES / 1024 / 1024) + " MB）"
                        );
                    }
                }
                zip.closeEntry();
            }
        }
    }

    /** 某个用户某个游戏某个版本的安装目录（已归一化，且保证在安装根目录内）。 */
    private Path installedRoot(Long userId, String gameCode, String version) {
        Path root = installDir()
                .resolve(String.valueOf(userId))
                .resolve(gameCode)
                .resolve(version)
                .toAbsolutePath()
                .normalize();
        if (!root.startsWith(installDir())) {
            throw new BusinessException("INVALID_INSTALL_PATH", "安装路径不合法");
        }
        return root;
    }

    public String readManifest(Long userId, GameProduct game, String version) {
        try {
            Path manifest = installedRoot(userId, game.getGameCode(), version)
                    .resolve("manifest.json");
            if (!Files.isRegularFile(manifest)) {
                return null;
            }
            return Files.readString(manifest, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return null;
        }
    }

    public Path resolveInstalledFile(
            Long userId,
            String gameCode,
            String version,
            String relativePath
    ) {
        Path root = installedRoot(userId, gameCode, version);
        Path file = root.resolve(relativePath).toAbsolutePath().normalize();
        // ⚠ 必须比到本游戏的版本目录 root，而不是只比安装根目录：
        // 只比安装根目录时，`../../<其他用户>/<其他游戏>/...` 这种路径也算"在根目录内"，
        // 能把别人的安装内容读出来。虽然 Tomcat 一般会把 `..` 归一化掉，
        // 但这一层校验本来就是用来兜住"一般不会发生"的情况。
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            throw new BusinessException("PLUGIN_FILE_NOT_FOUND", "插件资源文件不存在");
        }
        return file;
    }

    public void uninstall(Long userId, String gameCode) {
        try {
            Path target = installDir()
                    .resolve(String.valueOf(userId))
                    .resolve(gameCode)
                    .toAbsolutePath()
                    .normalize();
            if (target.startsWith(installDir())) {
                deleteRecursively(target);
            }
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_UNINSTALL_FAILED", "插件卸载失败");
        }
    }

    public String computeSha256(Path file) {
        try (InputStream input = Files.newInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException | NoSuchAlgorithmException ex) {
            throw new BusinessException("PACKAGE_HASH_FAILED", "插件包哈希计算失败");
        }
    }

    private void deleteQuietly(Path root) {
        try {
            deleteRecursively(root);
        } catch (IOException | BusinessException ex) {
            log.warn("清理目录失败：{}", root, ex);
        }
    }

    private void deleteRecursively(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ex) {
                    throw new BusinessException("DELETE_FAILED", "文件删除失败");
                }
            });
        }
    }
}
