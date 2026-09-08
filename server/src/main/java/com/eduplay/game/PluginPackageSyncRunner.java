package com.eduplay.game;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.util.List;

@Component
public class PluginPackageSyncRunner implements ApplicationRunner {

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
    @Transactional
    public void run(ApplicationArguments args) {
        List<GamePackage> packages = packageRepository.findAll();
        for (GamePackage gamePackage : packages) {
            try {
                var path = pluginPackageService.resolvePackage(gamePackage);
                gamePackage.setSha256(pluginPackageService.computeSha256(path));
                gamePackage.setSizeBytes(Files.size(path));
                gamePackage.setStatus("PUBLISHED");
                packageRepository.save(gamePackage);
            } catch (Exception ex) {
                gamePackage.setStatus("MISSING");
                packageRepository.save(gamePackage);
            }
        }
    }
}
