package com.eduplay.game;

import com.eduplay.common.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 启动时校准 game_package 的 sha256 / 大小 / 状态。
 *
 * <p>⚠ 两处必须克制：
 * <ul>
 *   <li><b>不要每次都重算哈希</b>：仓库里 plugins/packages 实测 157 个 zip / 250 MB，
 *       全量 SHA-256 在 U 盘上要 10 秒左右，而且这 10 秒会跟首屏接口抢同一块磁盘。
 *       文件大小没变、且库里已有哈希，就认为没变，直接跳过。</li>
 *   <li><b>不要把任何异常都标成 MISSING</b>：文件被别的进程短暂占用（杀软扫描、上传中）
 *       也会抛 IOException。原来那种写法会让一个包被永久打成 MISSING，
 *       而所有查询又都不按 status 过滤 —— 状态机就此失配，再也回不来。
 *       现在只有"文件确实不存在"才标 MISSING，其余是临时错误，记日志跳过。</li>
 * </ul>
 */
@Component
public class PluginPackageSyncRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PluginPackageSyncRunner.class);

    private final GamePackageRepository packageRepository;
    private final PluginPackageService pluginPackageService;

    public PluginPackageSyncRunner(
            GamePackageRepository packageRepository,
            PluginPackageService pluginPackageService
    ) {
        this.packageRepository = packageRepository;
        this.pluginPackageService = pluginPackageService;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<GamePackage> packages = packageRepository.findAll();
        int checked = 0;
        int skipped = 0;
        int missing = 0;

        for (GamePackage gamePackage : packages) {
            Path path;
            try {
                path = pluginPackageService.resolvePackage(gamePackage);
            } catch (BusinessException ex) {
                // 包文件真的不在：标 MISSING（且只在状态变化时写库）
                if (!"MISSING".equals(gamePackage.getStatus())) {
                    gamePackage.setStatus("MISSING");
                    packageRepository.save(gamePackage);
                }
                missing++;
                continue;
            }

            try {
                long size = Files.size(path);
                boolean unchanged = gamePackage.getSha256() != null
                        && gamePackage.getSizeBytes() != null
                        && gamePackage.getSizeBytes() == size
                        && "PUBLISHED".equals(gamePackage.getStatus());
                if (unchanged) {
                    skipped++;
                    continue;
                }
                gamePackage.setSha256(pluginPackageService.computeSha256(path));
                gamePackage.setSizeBytes(size);
                gamePackage.setStatus("PUBLISHED");
                packageRepository.save(gamePackage);
                checked++;
            } catch (Exception ex) {
                // 临时性 IO 错误（被占用、权限抖动）：保持原状，下次启动再说
                log.warn("跳过插件包校验（{}）：{}", gamePackage.getPackageName(), ex.getMessage());
            }
        }

        log.info("插件包校验完成：重算 {} 个，未变化跳过 {} 个，文件缺失 {} 个",
                checked, skipped, missing);
    }
}
