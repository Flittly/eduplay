package com.eduplay.game;

import com.eduplay.common.ApiResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 签发游戏 iframe 的短期访问票据。
 *
 * <p>路径刻意**不放在** {@code /api/v1/plugin/**} 下面：那一整个前缀在
 * {@code AuthFilter} 的白名单里（iframe 带不了 Authorization 头）。
 * 放在白名单里等于谁都能给自己签票，所以单独用 {@code /api/v1/play-ticket}，
 * 由过滤器正常校验登录态。
 */
@RestController
@RequestMapping("/api/v1/play-ticket")
@Profile("local")
public class PlayTicketController {

    private final PluginContentService pluginContentService;

    public PlayTicketController(PluginContentService pluginContentService) {
        this.pluginContentService = pluginContentService;
    }

    @PostMapping("/{gameCode}/{version}")
    public ApiResponse<PluginPlayTicketService.IssuedTicket> issue(
            @PathVariable String gameCode,
            @PathVariable String version
    ) {
        return ApiResponse.ok(pluginContentService.issueTicket(gameCode, version));
    }
}
