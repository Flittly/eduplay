package com.eduplay.cloudproxy;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/cloud-api")
@Profile("local")
public class CloudApiProxyController {

    private static final List<String> FORWARD_HEADERS = List.of(
            "Authorization",
            "Content-Type"
    );

    /**
     * 需要原样回传给浏览器的响应头。
     *
     * <p>原先只回传 {@code Content-Type}：
     * <ul>
     *   <li>云端返回 302 → 浏览器拿不到 {@code Location}，代理直接把状态码透传成 302 但
     *       没有跳转目标，前端只能看到一个空响应；</li>
     *   <li>云端 401 带的 {@code WWW-Authenticate}、限流带的 {@code Retry-After}
     *       全部丢失，语义在本地这一跳被抹平。</li>
     * </ul>
     * 注意 Content-Type 不在此列 —— 它由 {@code response.setContentType} 单独设置，
     * 放进循环会重复添加。
     */
    private static final java.util.Set<String> FORWARD_RESPONSE_HEADERS = java.util.Set.of(
            "location",
            "set-cookie",
            "www-authenticate",
            "retry-after",
            "content-disposition",
            "etag",
            "last-modified",
            "cache-control",
            "content-language"
    );

    private final com.eduplay.settings.SettingsService settingsService;

    public CloudApiProxyController(com.eduplay.settings.SettingsService settingsService) {
        this.settingsService = settingsService;
    }

    @RequestMapping("/**")
    public void proxy(
            HttpServletRequest request,
            HttpServletResponse response
    ) throws IOException {
        String path = request.getRequestURI().substring("/cloud-api".length());
        String query = request.getQueryString();
        String target = settingsService.getCloudBaseUrl()
                + path
                + (query == null || query.isBlank() ? "" : "?" + query);

        byte[] body = request.getInputStream().readAllBytes();
        URL url = URI.create(target).toURL();
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(request.getMethod());
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(60000);
        // 只有真的带 body 时才开 doOutput：GET 上一旦调用 getOutputStream()，
        // JDK 会把请求方法改写成 POST。
        connection.setDoOutput(body.length > 0);

        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames != null && headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            if (FORWARD_HEADERS.contains(headerName)
                    || "authorization".equals(headerName.toLowerCase(Locale.ROOT))
                    || "content-type".equals(headerName.toLowerCase(Locale.ROOT))) {
                Enumeration<String> values = request.getHeaders(headerName);
                while (values.hasMoreElements()) {
                    connection.setRequestProperty(headerName, values.nextElement());
                }
            }
        }

        if (body.length > 0) {
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
        }

        int status = connection.getResponseCode();
        String contentType = connection.getContentType();
        try (InputStream input = status >= 400
                ? connection.getErrorStream()
                : connection.getInputStream()) {
            response.setStatus(status);
            if (contentType != null) {
                response.setContentType(contentType);
            }
            // 把语义相关的响应头带回去（见 FORWARD_RESPONSE_HEADERS 的说明）
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                String name = header.getKey();
                if (name == null || header.getValue() == null) {
                    continue; // 第一项是状态行，key 为 null
                }
                if (!FORWARD_RESPONSE_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
                    continue;
                }
                for (String value : header.getValue()) {
                    response.addHeader(name, value);
                }
            }
            if (input != null) {
                input.transferTo(response.getOutputStream());
            }
        }
        response.getOutputStream().flush();
        connection.disconnect();
    }
}
