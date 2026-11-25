package com.eduplay.admin;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/codes")
public class AdminCodeController {

    private final AdminCodeService codeService;

    public AdminCodeController(AdminCodeService codeService) {
        this.codeService = codeService;
    }

    @GetMapping
    public ApiResponse<List<AdminCodeService.CodeResponse>> list(
    ) {
        return ApiResponse.ok(codeService.listCodes());
    }

    @PostMapping("/generate")
    public ApiResponse<List<AdminCodeService.CodeResponse>> generate(
            @Valid @RequestBody GenerateRequest request
    ) {
        return ApiResponse.ok(codeService.generateCodes(
                request.gameCode(),
                request.count()
        ));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
    ) {
        List<AdminCodeService.CodeResponse> codes = codeService.listCodes();
        StringBuilder csv = new StringBuilder("code,gameCode,status,usedBy,createdAt\n");
        for (AdminCodeService.CodeResponse code : codes) {
            csv.append(csvField(code.code())).append(",")
                    .append(csvField(code.gameCode())).append(",")
                    .append(csvField(code.status())).append(",")
                    .append(csvField(code.usedBy())).append(",")
                    .append(csvField(code.createdAt()))
                    .append("\n");
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv;charset=UTF-8"));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("activation-codes.csv", StandardCharsets.UTF_8)
                .build());
        return ResponseEntity.ok()
                .headers(headers)
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * CSV 字段转义。
     *
     * <p>两件事必须同时做，否则导出的文件在 Excel 里会出事：
     * <ol>
     *   <li><b>列结构</b>：username 允许包含逗号和引号，不转义会把一行拆成多列；</li>
     *   <li><b>公式注入</b>：以 {@code = + - @} 开头的单元格会被 Excel/Sheets 当公式执行
     *       （{@code =HYPERLINK(...)}、{@code cmd|'/c calc'!A1} 这类）。前面补一个单引号，
     *       让它老实当文本 —— 单引号本身不会显示在单元格里。</li>
     * </ol>
     */
    private static String csvField(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String text = value;
        char first = text.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@'
                || first == '\t' || first == '\r') {
            text = "'" + text;
        }
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) {
            return "\"" + text.replace("\"", "\"\"") + "\"";
        }
        return text;
    }

    public record GenerateRequest(
            @NotBlank(message = "游戏代码不能为空")
            String gameCode,
            @Min(value = 1, message = "数量不能少于1")
            @Max(value = 500, message = "数量不能超过500")
            int count
    ) {
    }
}
