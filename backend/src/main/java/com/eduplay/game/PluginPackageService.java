package com.eduplay.game;

import com.eduplay.common.BusinessException;
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
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class PluginPackageService {

    private final Path packageDir;
    private final Path installDir;

    public PluginPackageService(
            @Value("${eduplay.plugins.package-dir}") String packageDir,
            @Value("${eduplay.plugins.install-dir}") String installDir
    ) {
        this.packageDir = Path.of(packageDir).toAbsolutePath().normalize();
        this.installDir = Path.of(installDir).toAbsolutePath().normalize();
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

    public Path savePackage(String packageName, byte[] bytes) {
        try {
            Files.createDirectories(packageDir);
            Path file = packageDir.resolve(packageName).normalize();
            if (!file.startsWith(packageDir)) {
                throw new BusinessException("INVALID_PACKAGE_NAME", "插件包名称不合法");
            }
            Files.write(file, bytes);
            return file;
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_SAVE_FAILED", "插件包保存失败");
        }
    }

    public void install(Long userId, GameProduct game, GamePackage gamePackage) {
        try {
            Path packageFile = resolvePackage(gamePackage);
            Path targetRoot = installDir
                    .resolve(String.valueOf(userId))
                    .resolve(game.getGameCode())
                    .resolve(gamePackage.getVersion())
                    .toAbsolutePath()
                    .normalize();

            if (!targetRoot.startsWith(installDir)) {
                throw new BusinessException("INVALID_INSTALL_PATH", "安装路径不合法");
            }

            deleteRecursively(targetRoot);
            Files.createDirectories(targetRoot);

            try (ZipInputStream zip = new ZipInputStream(
                    Files.newInputStream(packageFile)
            )) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    Path target = targetRoot.resolve(entry.getName()).normalize();
                    if (!target.startsWith(targetRoot)) {
                        throw new BusinessException(
                                "INVALID_PACKAGE",
                                "插件包包含非法路径"
                        );
                    }
                    if (entry.isDirectory()) {
                        Files.createDirectories(target);
                    } else {
                        Files.createDirectories(target.getParent());
                        Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
                    }
                    zip.closeEntry();
                }
            }

            Path manifest = targetRoot.resolve("manifest.json");
            if (!Files.isRegularFile(manifest)) {
                throw new BusinessException("INVALID_PACKAGE", "插件包缺少 manifest.json");
            }
        } catch (BusinessException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new BusinessException("PACKAGE_INSTALL_FAILED", "插件解压失败");
        }
    }

    public String readManifest(Long userId, GameProduct game, String version) {
        try {
            Path manifest = installDir
                    .resolve(String.valueOf(userId))
                    .resolve(game.getGameCode())
                    .resolve(version)
                    .resolve("manifest.json")
                    .toAbsolutePath()
                    .normalize();
            if (!manifest.startsWith(installDir) || !Files.isRegularFile(manifest)) {
                return null;
            }
            return Files.readString(manifest, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return null;
        }
    }

    public void uninstall(Long userId, String gameCode) {
        try {
            Path target = installDir
                    .resolve(String.valueOf(userId))
                    .resolve(gameCode)
                    .toAbsolutePath()
                    .normalize();
            if (target.startsWith(installDir)) {
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
