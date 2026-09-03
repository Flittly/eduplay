package com.eduplay.student;

import com.eduplay.auth.AuthService;
import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class StudentService {

    private final AuthService authService;
    private final StudentRepository studentRepository;
    private final StudentPointsLedgerRepository ledgerRepository;

    public StudentService(
            AuthService authService,
            StudentRepository studentRepository,
            StudentPointsLedgerRepository ledgerRepository
    ) {
        this.authService = authService;
        this.studentRepository = studentRepository;
        this.ledgerRepository = ledgerRepository;
    }

    @Transactional
    public StudentImportResult importStudents(
            String authorizationHeader,
            MultipartFile file
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<StudentRow> rows = parseRows(file);
        List<StudentFailure> failures = new ArrayList<>();
        Set<String> fileStudentNos = new HashSet<>();
        List<StudentRow> validRows = new ArrayList<>();

        for (StudentRow row : rows) {
            List<String> rowErrors = validateImportRow(teacher.getId(), row, fileStudentNos);
            if (rowErrors.isEmpty()) {
                validRows.add(row);
            } else {
                failures.add(new StudentFailure(
                        row.rowNumber(),
                        row.name(),
                        row.studentNo(),
                        String.join("；", rowErrors)
                ));
            }
        }

        if (!failures.isEmpty()) {
            return new StudentImportResult(rows.size(), 0, failures.size(), failures);
        }

        int success = 0;
        for (StudentRow row : validRows) {
            createStudent(
                    teacher.getId(),
                    row.name(),
                    row.studentNo(),
                    row.className(),
                    row.initialPoints(),
                    "STUDENT_IMPORT"
            );
            success++;
        }
        return new StudentImportResult(rows.size(), success, 0, List.of());
    }

    @Transactional(readOnly = true)
    public List<StudentResponse> listStudents(
            String authorizationHeader,
            String keyword,
            String className
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        return findStudents(teacher.getId(), keyword, className).stream()
                .map(StudentResponse::from)
                .toList();
    }

    private List<Student> findStudents(
            Long teacherId,
            String keyword,
            String className
    ) {
        List<Student> students;

        if (keyword != null && !keyword.isBlank()) {
            students = studentRepository
                    .findByTeacherIdAndNameContainingIgnoreCaseOrderByNameAsc(
                            teacherId,
                            keyword.trim()
                    );
        } else if (className != null && !className.isBlank()) {
            students = studentRepository
                    .findByTeacherIdAndClassNameIgnoreCaseOrderByNameAsc(
                            teacherId,
                            className.trim()
                    );
        } else {
            students = studentRepository
                    .findByTeacherIdOrderByClassNameAscNameAsc(teacherId);
        }

        return students;
    }

    @Transactional(readOnly = true)
    public byte[] createExportWorkbook(
            String authorizationHeader,
            String keyword,
            String className
    ) throws IOException {
        AppUser teacher = requireTeacher(authorizationHeader);
        List<StudentResponse> students = findStudents(
                teacher.getId(),
                keyword,
                className
        ).stream()
                .map(StudentResponse::from)
                .toList();

        try (Workbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("学生名单");
            String[] headers = {"姓名", "学号", "班级", "初始积分"};
            Row header = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }

            int rowIndex = 1;
            for (StudentResponse student : students) {
                Row row = sheet.createRow(rowIndex++);
                row.createCell(0).setCellValue(student.name());
                row.createCell(1).setCellValue(student.studentNo());
                row.createCell(2).setCellValue(
                        student.className() == null ? "" : student.className()
                );
                row.createCell(3).setCellValue(student.totalPoints());
            }

            workbook.write(outputStream);
            return outputStream.toByteArray();
        }
    }

    @Transactional
    public StudentResponse addStudent(
            String authorizationHeader,
            AddStudentRequest request
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        String name = request.name().trim();
        String studentNo = request.studentNo().trim();

        if (name.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NAME", "姓名不能为空");
        }
        if (studentNo.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NO", "学号不能为空");
        }
        if (studentRepository.existsByTeacherIdAndStudentNo(teacher.getId(), studentNo)) {
            throw new BusinessException("STUDENT_NO_EXISTS", "该学号已存在");
        }

        Student student = createStudent(
                teacher.getId(),
                name,
                studentNo,
                request.className(),
                request.initialPoints() == null ? 0 : request.initialPoints(),
                "STUDENT_MANUAL_ADD"
        );
        return StudentResponse.from(student);
    }

    @Transactional
    public void deleteStudent(String authorizationHeader, Long studentId) {
        AppUser teacher = requireTeacher(authorizationHeader);
        Student student = getOwnedStudent(teacher.getId(), studentId);
        ledgerRepository.deleteByStudentId(student.getId());
        studentRepository.delete(student);
    }

    @Transactional
    public StudentPointsResponse adjustPoints(
            String authorizationHeader,
            Long studentId,
            AdjustPointsRequest request
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        Student student = getOwnedStudent(teacher.getId(), studentId);
        int amount = request.amount();

        if (amount == 0) {
            throw new BusinessException("INVALID_POINTS", "积分变动不能为0");
        }
        if (amount < -99999 || amount > 99999) {
            throw new BusinessException("INVALID_POINTS", "单次积分变动应在-99999到99999之间");
        }

        int balanceAfter = student.getTotalPoints() + amount;
        if (balanceAfter < 0) {
            throw new BusinessException("POINTS_NOT_ENOUGH", "扣减后积分不能小于0");
        }

        student.setTotalPoints(balanceAfter);
        studentRepository.saveAndFlush(student);

        StudentPointsLedger ledger = new StudentPointsLedger();
        ledger.setStudentId(student.getId());
        ledger.setTeacherId(teacher.getId());
        ledger.setChangeType(amount > 0 ? "MANUAL_EARN" : "MANUAL_DEDUCT");
        ledger.setAmount(amount);
        ledger.setBalanceAfter(balanceAfter);
        ledger.setBizType(request.reason() == null || request.reason().isBlank()
                ? "MANUAL_ADJUST"
                : request.reason().trim());
        ledger.setBizId(UUID.randomUUID().toString());
        ledger.setIdempotencyKey("manual:" + student.getId() + ":" + UUID.randomUUID());
        ledgerRepository.save(ledger);

        return StudentPointsResponse.from(student);
    }

    @Transactional(readOnly = true)
    public StudentPointsDetailResponse getStudentPoints(
            String authorizationHeader,
            Long studentId
    ) {
        AppUser teacher = requireTeacher(authorizationHeader);
        Student student = getOwnedStudent(teacher.getId(), studentId);
        List<StudentPointsLedger> ledgers =
                ledgerRepository.findByStudentIdOrderByCreatedAtDesc(student.getId());
        List<PointsLedgerResponse> ledgerResponses = ledgers.stream()
                .map(PointsLedgerResponse::from)
                .toList();
        return new StudentPointsDetailResponse(
                StudentResponse.from(student),
                ledgerResponses
        );
    }

    public byte[] createImportTemplate() throws IOException {
        try (Workbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("学生导入模板");
            String[] headers = {"姓名", "学号", "班级", "初始积分"};
            Row header = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }

            Row example = sheet.createRow(1);
            example.createCell(0).setCellValue("张三");
            example.createCell(1).setCellValue("20260001");
            example.createCell(2).setCellValue("高一1班");
            example.createCell(3).setCellValue(0);

            workbook.write(outputStream);
            return outputStream.toByteArray();
        }
    }

    private Student createStudent(
            Long teacherId,
            String name,
            String studentNo,
            String className,
            int initialPoints,
            String bizType
    ) {
        Student student = new Student();
        student.setTeacherId(teacherId);
        student.setName(name.trim());
        student.setStudentNo(studentNo.trim());
        student.setClassName(className == null ? null : className.trim());
        student.setTotalPoints(initialPoints);
        student.setVersion(0L);
        studentRepository.saveAndFlush(student);

        if (initialPoints != 0) {
            StudentPointsLedger ledger = new StudentPointsLedger();
            ledger.setStudentId(student.getId());
            ledger.setTeacherId(teacherId);
            ledger.setChangeType("INIT");
            ledger.setAmount(initialPoints);
            ledger.setBalanceAfter(initialPoints);
            ledger.setBizType(bizType);
            ledger.setBizId("student:" + student.getId());
            ledger.setIdempotencyKey("init:" + student.getId());
            ledgerRepository.save(ledger);
        }
        return student;
    }

    private List<String> validateImportRow(
            Long teacherId,
            StudentRow row,
            Set<String> fileStudentNos
    ) {
        List<String> errors = new ArrayList<>();
        String name = row.name() == null ? "" : row.name().trim();
        String studentNo = row.studentNo() == null ? "" : row.studentNo().trim();

        if (name.isBlank()) {
            errors.add("姓名不能为空");
        }
        if (studentNo.isBlank()) {
            errors.add("学号不能为空");
        } else {
            if (studentNo.length() > 64) {
                errors.add("学号不能超过64位");
            }
            if (!fileStudentNos.add(studentNo)) {
                errors.add("学号在文件中重复");
            }
            if (studentRepository.existsByTeacherIdAndStudentNo(teacherId, studentNo)) {
                errors.add("学号已存在");
            }
        }

        if (row.className() != null && row.className().trim().length() > 64) {
            errors.add("班级不能超过64位");
        }
        if (row.initialPoints() < 0 || row.initialPoints() > 99999) {
            errors.add("初始积分应在0到99999之间");
        }
        return errors;
    }

    private List<StudentRow> parseRows(MultipartFile file) {
        if (file.isEmpty()) {
            throw new BusinessException("EMPTY_FILE", "请选择要导入的 Excel 文件");
        }

        try (Workbook workbook = WorkbookFactory.create(file.getInputStream())) {
            Sheet sheet = workbook.getSheetAt(0);
            DataFormatter formatter = new DataFormatter(Locale.CHINA);
            Map<String, Integer> headerIndex = readHeader(sheet, formatter);
            int nameIndex = headerIndex.getOrDefault("姓名", -1);
            int studentNoIndex = headerIndex.getOrDefault("学号", -1);
            int classNameIndex = headerIndex.getOrDefault("班级", -1);
            int pointsIndex = headerIndex.getOrDefault("初始积分", -1);

            if (nameIndex < 0 || studentNoIndex < 0) {
                throw new BusinessException(
                        "INVALID_TEMPLATE",
                        "Excel 必须包含“姓名”和“学号”两列"
                );
            }

            List<StudentRow> rows = new ArrayList<>();
            for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
                Row row = sheet.getRow(rowIndex);
                if (row == null || isBlankRow(row, formatter)) {
                    continue;
                }

                String name = cellText(row.getCell(nameIndex), formatter).trim();
                String studentNo = cellText(row.getCell(studentNoIndex), formatter).trim();
                String className = classNameIndex < 0
                        ? null
                        : cellText(row.getCell(classNameIndex), formatter).trim();
                int initialPoints = pointsIndex < 0
                        ? 0
                        : parseInt(cellText(row.getCell(pointsIndex), formatter), rowIndex);

                rows.add(new StudentRow(
                        rowIndex + 1,
                        name,
                        studentNo,
                        className,
                        initialPoints
                ));
            }

            if (rows.isEmpty()) {
                throw new BusinessException("EMPTY_SHEET", "Excel 中没有学生数据");
            }
            return rows;
        } catch (IOException ex) {
            throw new BusinessException("FILE_READ_ERROR", "Excel 文件读取失败");
        }
    }

    private Map<String, Integer> readHeader(Sheet sheet, DataFormatter formatter) {
        Row header = sheet.getRow(0);
        if (header == null) {
            throw new BusinessException("INVALID_TEMPLATE", "Excel 缺少表头");
        }

        Map<String, Integer> headerIndex = new LinkedHashMap<>();
        for (Cell cell : header) {
            String value = formatter.formatCellValue(cell).trim();
            if (!value.isBlank()) {
                headerIndex.put(value, cell.getColumnIndex());
            }
        }
        return headerIndex;
    }

    private String cellText(Cell cell, DataFormatter formatter) {
        return cell == null ? "" : formatter.formatCellValue(cell);
    }

    private boolean isBlankRow(Row row, DataFormatter formatter) {
        for (Cell cell : row) {
            if (!cellText(cell, formatter).trim().isBlank()) {
                return false;
            }
        }
        return true;
    }

    private int parseInt(String text, int rowNumber) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        try {
            return Integer.parseInt(text.trim());
        } catch (NumberFormatException ex) {
            throw new BusinessException(
                    "INVALID_POINTS",
                    "第" + rowNumber + "行初始积分不是有效整数"
            );
        }
    }

    private AppUser requireTeacher(String authorizationHeader) {
        AppUser user = authService.requireUser(authorizationHeader);
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以管理学生");
        }
        return user;
    }

    private Student getOwnedStudent(Long teacherId, Long studentId) {
        return studentRepository.findByIdAndTeacherId(studentId, teacherId)
                .orElseThrow(() -> new NotFoundException("学生不存在或不属于当前教师"));
    }

    public record StudentRow(
            int rowNumber,
            String name,
            String studentNo,
            String className,
            int initialPoints
    ) {
    }

    public record StudentImportResult(
            int total,
            int success,
            int failed,
            List<StudentFailure> failures
    ) {
    }

    public record StudentFailure(
            int rowNumber,
            String name,
            String studentNo,
            String reason
    ) {
    }

    public record AddStudentRequest(
            String name,
            String studentNo,
            String className,
            Integer initialPoints
    ) {
    }

    public record AdjustPointsRequest(
            int amount,
            String reason
    ) {
    }

    public record StudentResponse(
            Long id,
            String name,
            String studentNo,
            String className,
            int totalPoints
    ) {
        public static StudentResponse from(Student student) {
            return new StudentResponse(
                    student.getId(),
                    student.getName(),
                    student.getStudentNo(),
                    student.getClassName(),
                    student.getTotalPoints()
            );
        }
    }

    public record StudentPointsResponse(
            Long id,
            String name,
            String studentNo,
            String className,
            int totalPoints
    ) {
        public static StudentPointsResponse from(Student student) {
            return new StudentPointsResponse(
                    student.getId(),
                    student.getName(),
                    student.getStudentNo(),
                    student.getClassName(),
                    student.getTotalPoints()
            );
        }
    }

    public record PointsLedgerResponse(
            Long id,
            String changeType,
            int amount,
            int balanceAfter,
            String bizType,
            String createdAt
    ) {
        public static PointsLedgerResponse from(StudentPointsLedger ledger) {
            return new PointsLedgerResponse(
                    ledger.getId(),
                    ledger.getChangeType(),
                    ledger.getAmount(),
                    ledger.getBalanceAfter(),
                    ledger.getBizType(),
                    ledger.getCreatedAt().toString()
            );
        }
    }

    public record StudentPointsDetailResponse(
            StudentResponse student,
            List<PointsLedgerResponse> ledger
    ) {
    }
}
