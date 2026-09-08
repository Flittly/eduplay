package com.eduplay.student;

import com.eduplay.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/v1/students")
@Profile("local")
public class StudentController {

    private final StudentService studentService;

    public StudentController(StudentService studentService) {
        this.studentService = studentService;
    }

    @GetMapping
    public ApiResponse<List<StudentService.StudentResponse>> listStudents(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "className", required = false) String className
    ) {
        return ApiResponse.ok(studentService.listStudents(
                authorization,
                keyword,
                className
        ));
    }

    @GetMapping("/classes")
    public ApiResponse<List<String>> listClassNames(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        return ApiResponse.ok(studentService.listClassNames(authorization));
    }

    @PostMapping
    public ApiResponse<StudentService.StudentResponse> addStudent(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody AddStudentRequest request
    ) {
        StudentService.AddStudentRequest serviceRequest =
                new StudentService.AddStudentRequest(
                        request.name(),
                        request.studentNo(),
                        request.className(),
                        request.initialPoints()
                );
        return ApiResponse.ok(studentService.addStudent(authorization, serviceRequest));
    }

    @DeleteMapping("/{studentId}")
    public ApiResponse<Void> deleteStudent(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long studentId
    ) {
        studentService.deleteStudent(authorization, studentId);
        return ApiResponse.ok();
    }

    @PutMapping("/{studentId}")
    public ApiResponse<StudentService.StudentResponse> updateStudent(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long studentId,
            @Valid @RequestBody UpdateStudentRequest request
    ) {
        StudentService.UpdateStudentRequest serviceRequest =
                new StudentService.UpdateStudentRequest(
                        request.name(),
                        request.studentNo(),
                        request.className(),
                        request.totalPoints()
                );
        return ApiResponse.ok(studentService.updateStudent(
                authorization,
                studentId,
                serviceRequest
        ));
    }

    @PostMapping("/{studentId}/points")
    public ApiResponse<StudentService.StudentPointsResponse> adjustPoints(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long studentId,
            @Valid @RequestBody AdjustPointsRequest request
    ) {
        StudentService.AdjustPointsRequest serviceRequest =
                new StudentService.AdjustPointsRequest(request.amount(), request.reason());
        return ApiResponse.ok(studentService.adjustPoints(
                authorization,
                studentId,
                serviceRequest
        ));
    }

    @GetMapping("/{studentId}/points")
    public ApiResponse<StudentService.StudentPointsDetailResponse> getStudentPoints(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable Long studentId
    ) {
        return ApiResponse.ok(studentService.getStudentPoints(authorization, studentId));
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<StudentService.StudentImportResult> importStudents(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam("file") MultipartFile file
    ) {
        return ApiResponse.ok(studentService.importStudents(authorization, file));
    }

    @GetMapping("/import/template")
    public ResponseEntity<byte[]> downloadTemplate() throws IOException {
        byte[] template = studentService.createImportTemplate();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("student-import-template.xlsx", StandardCharsets.UTF_8)
                .build());
        headers.setContentLength(template.length);
        return ResponseEntity.ok()
                .headers(headers)
                .body(template);
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> exportStudents(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "className", required = false) String className
    ) throws IOException {
        byte[] workbook = studentService.createExportWorkbook(
                authorization,
                keyword,
                className
        );
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("students-export.xlsx", StandardCharsets.UTF_8)
                .build());
        headers.setContentLength(workbook.length);
        return ResponseEntity.ok()
                .headers(headers)
                .body(workbook);
    }

    public record AddStudentRequest(
            @NotBlank(message = "姓名不能为空")
            @Size(max = 64, message = "姓名不能超过64位")
            String name,
            @NotBlank(message = "学号不能为空")
            @Size(max = 64, message = "学号不能超过64位")
            String studentNo,
            @Size(max = 64, message = "班级不能超过64位")
            String className,
            Integer initialPoints
    ) {
    }

    public record AdjustPointsRequest(
            int amount,
            @Size(max = 64, message = "原因不能超过64位")
            String reason
    ) {
    }

    public record UpdateStudentRequest(
            @NotBlank(message = "姓名不能为空")
            @Size(max = 64, message = "姓名不能超过64位")
            String name,
            @NotBlank(message = "学号不能为空")
            @Size(max = 64, message = "学号不能超过64位")
            String studentNo,
            @Size(max = 64, message = "班级不能超过64位")
            String className,
            Integer totalPoints
    ) {
    }
}
