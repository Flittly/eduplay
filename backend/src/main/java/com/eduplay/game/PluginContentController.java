package com.eduplay.game;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import org.springframework.context.annotation.Profile;

@RestController
@RequestMapping("/api/v1/plugin")
@Profile("local")
public class PluginContentController {

    private final PluginContentService pluginContentService;

    public PluginContentController(PluginContentService pluginContentService) {
        this.pluginContentService = pluginContentService;
    }

    @GetMapping("/{token}/{gameCode}/{version}/{*path}")
    public ResponseEntity<byte[]> servePluginFile(
            @PathVariable String token,
            @PathVariable String gameCode,
            @PathVariable String version,
            @PathVariable String path
    ) throws IOException {
        PluginContentService.PluginFile pluginFile =
                pluginContentService.serveFile(token, gameCode, version, path);

        byte[] bytes = Files.readAllBytes(pluginFile.path());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(pluginFile.mediaType()));
        headers.setCacheControl(CacheControl.noStore());
        headers.setContentLength(bytes.length);
        // 请求路径里带着主登录令牌（/plugin/{token}/...），游戏包一旦引用外链
        // 字体或 CDN，默认的 Referer 会把整条带令牌的 URL 送给第三方。
        // 前端 iframe 已加 referrerPolicy，这里再从响应头兜一层。
        headers.set("Referrer-Policy", "no-referrer");

        return ResponseEntity.ok()
                .headers(headers)
                .body(bytes);
    }
}
