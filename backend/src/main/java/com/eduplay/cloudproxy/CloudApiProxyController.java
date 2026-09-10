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

@RestController
@RequestMapping("/cloud-api")
@Profile("local")
public class CloudApiProxyController {

    private static final List<String> FORWARD_HEADERS = List.of(
            "Authorization",
            "Content-Type"
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
        connection.setDoOutput(true);

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
            if (input != null) {
                input.transferTo(response.getOutputStream());
            }
        }
        response.getOutputStream().flush();
        connection.disconnect();
    }
}
