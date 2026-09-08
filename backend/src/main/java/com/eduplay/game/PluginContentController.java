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

        return ResponseEntity.ok()
                .headers(headers)
                .body(bytes);
    }
}
