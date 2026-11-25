package com.eduplay.game;

import org.springframework.context.annotation.Profile;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
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
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/plugin")
@Profile("local")
public class PluginContentController {

    private final PluginContentService pluginContentService;

    public PluginContentController(PluginContentService pluginContentService) {
        this.pluginContentService = pluginContentService;
    }

    @GetMapping("/{token}/{gameCode}/{version}/{*path}")
    public ResponseEntity<Resource> servePluginFile(
            @PathVariable String token,
            @PathVariable String gameCode,
            @PathVariable String version,
            @PathVariable String path
    ) throws IOException {
        PluginContentService.PluginFile pluginFile =
                pluginContentService.serveFile(token, gameCode, version, path);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(pluginFile.mediaType()));
        // ⚠ 路径里已经带了 {version}，同一 URL 的内容**永远不变**，
        // 因此可以放心让浏览器长期缓存。原先是 no-store（完全不可缓存）：
        // 每开一次游戏都要把 4~8 MB 资源重新走一遍网络 + 后端，
        // 而每次请求后端还要查 4 次库。改成 immutable 之后，第二次打开是 0 字节、0 次查询。
        headers.setCacheControl(CacheControl
                .maxAge(365, TimeUnit.DAYS)
                .cachePrivate()
                .immutable());
        // 请求路径里带着票据（/plugin/{ticket}/...），游戏包一旦引用外链
        // 字体或 CDN，默认的 Referer 会把整条带票据的 URL 送给第三方。
        // 前端 iframe 已加 referrerPolicy，这里再从响应头兜一层。
        headers.set("Referrer-Policy", "no-referrer");
        headers.setContentLength(Files.size(pluginFile.path()));

        // 用 Resource 直接交给 Spring 流式拷贝：原先是 Files.readAllBytes
        // 把整个文件读进堆内存再写出去，一个 3 MB 的贴图就白占 3 MB 堆。
        return ResponseEntity.ok()
                .headers(headers)
                .body(new FileSystemResource(pluginFile.path()));
    }
}
