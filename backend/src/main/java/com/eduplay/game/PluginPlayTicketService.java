package com.eduplay.game;

import com.eduplay.common.BusinessException;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 游戏 iframe 的短期访问票据。
 *
 * <h2>为什么不能把登录 token 直接拼进 iframe 地址</h2>
 * 游戏页面是 iframe 加载的，浏览器发请求时带不了 {@code Authorization} 头，
 * 所以原先的写法是把**主登录 token** 直接放进 URL：
 * {@code /api/v1/plugin/<主token>/<gameCode>/<version>/...}。
 * 后果是：
 * <ul>
 *   <li>token 是**永久有效**的，URL 一旦被记录（浏览器历史、截图、误粘贴、
 *       游戏包里的外链带 Referer），等同于把整个账号永久交出去；</li>
 *   <li>它和主登录凭证是同一个东西，泄漏的范围不止"一个游戏"，而是所有接口。</li>
 * </ul>
 *
 * <h2>票据的边界</h2>
 * 短随机串 + 8 小时有效期 + 只对**一个游戏的某一个版本**有效。
 * 泄漏后最坏情况是别人能读到这一局游戏的静态资源，不会拿到任何接口权限；
 * 后端重启会清空票据，前端重进游戏即可。
 */
@Service
@Profile("local")
public class PluginPlayTicketService {

    private static final Duration TTL = Duration.ofHours(8);
    private static final SecureRandom RANDOM = new SecureRandom();

    private record Ticket(Long userId, String gameCode, String version, Instant expiresAt) {
    }

    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();

    public IssuedTicket issue(Long userId, String gameCode, String version) {
        purgeExpired();
        byte[] raw = new byte[24];
        RANDOM.nextBytes(raw);
        String token = HexFormat.of().formatHex(raw);
        Instant expiresAt = Instant.now().plus(TTL);
        tickets.put(token, new Ticket(userId, gameCode, version, expiresAt));
        return new IssuedTicket(token, expiresAt.toString());
    }

    /**
     * 校验票据，返回它绑定的用户。票据、游戏、版本三者必须完全对得上。
     */
    public Long require(String token, String gameCode, String version) {
        if (token == null || token.isBlank()) {
            throw new BusinessException("UNAUTHORIZED", "缺少游戏访问凭证");
        }
        Ticket ticket = tickets.get(token);
        Instant now = Instant.now();
        if (ticket == null || !ticket.expiresAt().isAfter(now)) {
            if (ticket != null) {
                tickets.remove(token);
            }
            throw new BusinessException(
                    "UNAUTHORIZED",
                    "游戏访问凭证已失效，请返回游戏中心重新进入"
            );
        }
        if (!ticket.gameCode().equals(gameCode)
                || !ticket.version().equals(version)) {
            // 票据只对一个游戏的某一个版本有效，不能拿来横向读别的包
            throw new BusinessException("FORBIDDEN", "游戏访问凭证与请求的资源不匹配");
        }
        return ticket.userId();
    }

    private void purgeExpired() {
        Instant now = Instant.now();
        tickets.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
    }

    public record IssuedTicket(String ticket, String expiresAt) {
    }
}
