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
import org.springframework.web.bind.annotation.RequestHeader;
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
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(codeService.listCodes(authorization));
    }

    @PostMapping("/generate")
    public ApiResponse<List<AdminCodeService.CodeResponse>> generate(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody GenerateRequest request
    ) {
        return ApiResponse.ok(codeService.generateCodes(
                authorization,
                request.gameCode(),
                request.count()
        ));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        List<AdminCodeService.CodeResponse> codes = codeService.listCodes(authorization);
        StringBuilder csv = new StringBuilder("code,gameCode,status,usedBy,createdAt\n");
        for (AdminCodeService.CodeResponse code : codes) {
            csv.append(code.code()).append(",")
                    .append(code.gameCode()).append(",")
                    .append(code.status()).append(",")
                    .append(code.usedBy() == null ? "" : code.usedBy()).append(",")
                    .append(code.createdAt() == null ? "" : code.createdAt())
                    .append("\n");
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv"));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("activation-codes.csv", StandardCharsets.UTF_8)
                .build());
        return ResponseEntity.ok()
                .headers(headers)
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
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
