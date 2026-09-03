package com.eduplay.game;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.user.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
public class GameStoreService {

    private final AuthService authService;
    private final GameProductRepository gameProductRepository;
    private final UserGameInstallRepository installRepository;

    public GameStoreService(
            AuthService authService,
            GameProductRepository gameProductRepository,
            UserGameInstallRepository installRepository
    ) {
        this.authService = authService;
        this.gameProductRepository = gameProductRepository;
        this.installRepository = installRepository;
    }

    @Transactional(readOnly = true)
    public List<StoreGameResponse> listStoreGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<UserGameInstall> installs = installRepository.findByUserId(teacher.getId());

        return gameProductRepository.findByStatusOrderByIdAsc("ACTIVE").stream()
                .map(game -> toStoreGame(game, installs))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<InstalledGameResponse> listInstalledGames(String authorizationHeader) {
        AppUser teacher = requireTeacher(authorizationHeader);
        return installRepository.findByUserId(teacher.getId()).stream()
                .map(install -> gameProductRepository.findById(install.getGameId())
                        .filter(game -> "ACTIVE".equals(game.getStatus()))
                        .map(game -> InstalledGameResponse.from(game, install))
                        .orElse(null))
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    @Transactional
    public StoreGameResponse installGame(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);

        UserGameInstall install = installRepository
                .findByUserIdAndGameId(teacher.getId(), game.getId())
                .orElseGet(() -> {
                    UserGameInstall newInstall = new UserGameInstall();
                    newInstall.setUserId(teacher.getId());
                    newInstall.setGameId(game.getId());
                    newInstall.setInstalledVersion(game.getVersion());
                    newInstall.setStatus("INSTALLED");
                    newInstall.setInstalledAt(Instant.now());
                    return installRepository.save(newInstall);
                });

        if (!game.getVersion().equals(install.getInstalledVersion())) {
            install.setInstalledVersion(game.getVersion());
            install.setStatus("INSTALLED");
            installRepository.save(install);
        }

        return toStoreGame(game, List.of(install));
    }

    @Transactional
    public void uninstallGame(String authorizationHeader, String gameCode) {
        AppUser teacher = requireTeacher(authorizationHeader);
        GameProduct game = getGame(gameCode);
        installRepository.findByUserIdAndGameId(teacher.getId(), game.getId())
                .ifPresent(installRepository::delete);
    }

    private AppUser requireTeacher(String authorizationHeader) {
        AppUser user = authService.requireUser(authorizationHeader);
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以安装游戏");
        }
        return user;
    }

    private GameProduct getGame(String gameCode) {
        return gameProductRepository.findByGameCode(gameCode)
                .orElseThrow(() -> new BusinessException("GAME_NOT_FOUND", "游戏不存在"));
    }

    private StoreGameResponse toStoreGame(
            GameProduct game,
            List<UserGameInstall> installs
    ) {
        UserGameInstall install = installs.stream()
                .filter(item -> item.getGameId().equals(game.getId()))
                .findFirst()
                .orElse(null);

        return new StoreGameResponse(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                game.getPriceCents(),
                game.getVersion(),
                install != null,
                install == null ? null : install.getInstalledVersion()
        );
    }

    public record StoreGameResponse(
            Long id,
            String gameCode,
            String name,
            String description,
            String coverUrl,
            Integer priceCents,
            String version,
            boolean installed,
            String installedVersion
    ) {
    }

    public record InstalledGameResponse(
            Long id,
            String gameCode,
            String name,
            String description,
            String coverUrl,
            String version,
            String installedVersion,
            String status
    ) {
        public static InstalledGameResponse from(
                GameProduct game,
                UserGameInstall install
        ) {
            return new InstalledGameResponse(
                    game.getId(),
                    game.getGameCode(),
                    game.getName(),
                    game.getDescription(),
                    game.getCoverUrl(),
                    game.getVersion(),
                    install.getInstalledVersion(),
                    install.getStatus()
            );
        }
    }
}

