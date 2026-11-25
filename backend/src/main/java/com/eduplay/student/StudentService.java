package com.eduplay.student;

import com.eduplay.auth.AuthContext;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import com.eduplay.game.GameProduct;
import com.eduplay.game.GameProductRepository;
import com.eduplay.user.AppUser;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.context.annotation.Profile;
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
@Profile("local")
public class StudentService {

    /** 与游戏结算（GameScoreService.MAX_SCORE）、Excel 导入保持一致的积分上限。 */
    private static final int MAX_POINTS = 99999;

    /**
     * 单次导入的行数上限。
     *
     * <p>不加限制时，一个「只有表头 + 第 100 万行有内容」的稀疏表会让
     * {@code sheet.getLastRowNum()} 返回 100 万，循环空转百万次再逐行判空 ——
     * 内存与 CPU 都白烧，最后还可能被 OOM 打断。
     */
    private static final int MAX_IMPORT_ROWS = 2000;

    private final StudentRepository studentRepository;
    private final StudentPointsLedgerRepository ledgerRepository;
    private final GameProductRepository gameProductRepository;

    public StudentService(
            StudentRepository studentRepository,
            StudentPointsLedgerRepository ledgerRepository,
            GameProductRepository gameProductRepository
    ) {
        this.studentRepository = studentRepository;
        this.ledgerRepository = ledgerRepository;
        this.gameProductRepository = gameProductRepository;
    }

    @Transactional
    public StudentImportResult importStudents(
            MultipartFile file
    ) {
        AppUser teacher = requireTeacher();
        List<StudentRow> rows = parseRows(file);
        List<StudentFailure> failures = new ArrayList<>();
        Set<String> fileStudentKeys = new HashSet<>();
        List<StudentRow> validRows = new ArrayList<>();

        // 一次性把该教师现有的「班级 + 学号」全取出来判重。
        // 原先每行一次 existsByTeacherIdAndClassNameAndStudentNo：500 行 = 500 次查询，
        // 而教师名下通常也就几百个学生，一次全取反而更便宜。
        Set<String> existingKeys = new HashSet<>();
        for (Object[] key : studentRepository.findClassStudentKeys(teacher.getId())) {
            existingKeys.add(classStudentKey((String) key[0], (String) key[1]));
        }

        for (StudentRow row : rows) {
            List<String> rowErrors = validateImportRow(row, fileStudentKeys, existingKeys);
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

        // 批量插入：先一次 saveAll 拿到自增主键，再批量写初始积分流水。
        // 原先逐行 createStudent（每行一次 saveAndFlush + 一次 ledger save），
        // 500 行就是 1000 次往返还外加 500 次 flush。
        List<Student> toCreate = new ArrayList<>(validRows.size());
        for (StudentRow row : validRows) {
            Student student = new Student();
            student.setTeacherId(teacher.getId());
            student.setName(row.name().trim());
            student.setStudentNo(row.studentNo().trim());
            student.setClassName(normalizeClassName(row.className()));
            student.setTotalPoints(row.initialPoints());
            student.setVersion(0L);
            toCreate.add(student);
        }
        List<Student> saved = studentRepository.saveAll(toCreate);
        studentRepository.flush();

        List<StudentPointsLedger> ledgers = new ArrayList<>();
        for (int i = 0; i < saved.size(); i++) {
            int initialPoints = validRows.get(i).initialPoints();
            if (initialPoints == 0) {
                continue;
            }
            Student student = saved.get(i);
            StudentPointsLedger ledger = new StudentPointsLedger();
            ledger.setStudentId(student.getId());
            ledger.setTeacherId(teacher.getId());
            ledger.setChangeType("INIT");
            ledger.setAmount(initialPoints);
            ledger.setBalanceAfter(initialPoints);
            ledger.setBizType("STUDENT_IMPORT");
            ledger.setBizId("student:" + student.getId());
            ledger.setIdempotencyKey("init:" + student.getId());
            ledgers.add(ledger);
        }
        if (!ledgers.isEmpty()) {
            ledgerRepository.saveAll(ledgers);
        }
        return new StudentImportResult(rows.size(), saved.size(), 0, List.of());
    }

    private static String classStudentKey(String className, String studentNo) {
        return (className == null ? "" : className) + "::" + (studentNo == null ? "" : studentNo);
    }

    @Transactional(readOnly = true)
    public List<StudentResponse> listStudents(
            String keyword,
            String className
    ) {
        AppUser teacher = requireTeacher();
        return findStudents(teacher.getId(), keyword, className).stream()
                .map(StudentResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<String> listClassNames() {
        AppUser teacher = requireTeacher();
        return studentRepository.findByTeacherIdOrderByClassNameAscNameAsc(teacher.getId())
                .stream()
                .map(Student::getClassName)
                .distinct()
                .sorted()
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
            String keyword,
            String className
    ) throws IOException {
        AppUser teacher = requireTeacher();
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
            AddStudentRequest request
    ) {
        AppUser teacher = requireTeacher();
        String name = request.name().trim();
        String studentNo = request.studentNo().trim();
        String className = normalizeClassName(request.className());

        if (name.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NAME", "姓名不能为空");
        }
        if (studentNo.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NO", "学号不能为空");
        }
        if (studentRepository.existsByTeacherIdAndClassNameAndStudentNo(
                teacher.getId(),
                className,
                studentNo
        )) {
            throw new BusinessException("STUDENT_NO_EXISTS", "该班级下学号已存在");
        }

        // Excel 导入那条路径校验了「初始积分 0~99999」，手工新增这条路原先一个数都不校验：
        // 填 -5 或 1e9 都能直接落库，之后所有「班级均分」「排行榜」全被这一个值带偏。
        int initialPoints = request.initialPoints() == null ? 0 : request.initialPoints();
        if (initialPoints < 0 || initialPoints > MAX_POINTS) {
            throw new BusinessException("INVALID_POINTS", "初始积分应在0到" + MAX_POINTS + "之间");
        }

        Student student = createStudent(
                teacher.getId(),
                name,
                studentNo,
                className,
                initialPoints,
                "STUDENT_MANUAL_ADD"
        );
        return StudentResponse.from(student);
    }

    @Transactional
    public StudentResponse updateStudent(
            Long studentId,
            UpdateStudentRequest request
    ) {
        AppUser teacher = requireTeacher();
        // 加行锁：这里同样要「读旧值 → 算差额 → 写新值」，不加锁时与游戏结算并发
        // 会互相覆盖（积分对了但流水记错，或直接乐观锁 500）。
        Student student = getOwnedStudentForUpdate(teacher.getId(), studentId);
        String name = request.name().trim();
        String studentNo = request.studentNo().trim();
        String className = normalizeClassName(request.className());

        if (name.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NAME", "姓名不能为空");
        }
        if (studentNo.isBlank()) {
            throw new BusinessException("INVALID_STUDENT_NO", "学号不能为空");
        }
        if (studentRepository.existsByTeacherIdAndClassNameAndStudentNoAndIdNot(
                teacher.getId(),
                className,
                studentNo,
                studentId
        )) {
            throw new BusinessException("STUDENT_NO_EXISTS", "该班级下学号已存在");
        }

        student.setName(name);
        student.setStudentNo(studentNo);
        student.setClassName(className);

        if (request.totalPoints() != null
                && !request.totalPoints().equals(student.getTotalPoints())) {
            int newTotal = request.totalPoints();
            // 原先只判了 < 0：填 999999999 也能存进去，同样能把班级均分算歪。
            if (newTotal < 0 || newTotal > MAX_POINTS) {
                throw new BusinessException(
                        "INVALID_POINTS",
                        "积分应在0到" + MAX_POINTS + "之间"
                );
            }
            int delta = newTotal - student.getTotalPoints();
            student.setTotalPoints(newTotal);
            StudentPointsLedger ledger = new StudentPointsLedger();
            ledger.setStudentId(student.getId());
            ledger.setTeacherId(teacher.getId());
            ledger.setChangeType(delta > 0 ? "MANUAL_EARN" : "MANUAL_DEDUCT");
            ledger.setAmount(delta);
            ledger.setBalanceAfter(newTotal);
            ledger.setBizType("EDIT_STUDENT");
            ledger.setBizId(UUID.randomUUID().toString());
            // 这里写的是「绝对值改成多少」，重复提交时第二次会因为
            // `!equals(student.getTotalPoints())` 直接跳过，不会重复记账，
            // 所以键的唯一性只需保证不与别的记录撞车即可。
            ledger.setIdempotencyKey("edit:" + student.getId() + ":" + UUID.randomUUID());
            ledgerRepository.save(ledger);
        }

        studentRepository.saveAndFlush(student);
        return StudentResponse.from(student);
    }

    @Transactional
    public void deleteStudent(Long studentId) {
        AppUser teacher = requireTeacher();
        Student student = getOwnedStudent(teacher.getId(), studentId);
        ledgerRepository.deleteByStudentId(student.getId());
        studentRepository.delete(student);
    }

    @Transactional
    public StudentPointsResponse adjustPoints(
            Long studentId,
            AdjustPointsRequest request
    ) {
        AppUser teacher = requireTeacher();
        // 行锁：积分是累加语义，并发下两个请求读到同一个旧值会互相覆盖；
        // 学生表有 @Version，覆盖不了就直接抛乐观锁异常 —— 双击「+10」必有一个 500。
        Student student = getOwnedStudentForUpdate(teacher.getId(), studentId);
        int amount = request.amount();

        if (amount == 0) {
            throw new BusinessException("INVALID_POINTS", "积分变动不能为0");
        }
        if (amount < -99999 || amount > 99999) {
            throw new BusinessException("INVALID_POINTS", "单次积分变动应在-99999到99999之间");
        }

        // 幂等键原先用 UUID.randomUUID()：每次重试都是**新键**，
        // 唯一约束永远不会冲突，等于完全没有幂等 —— 网络超时后前端重发一次，
        // 学生就被加了两次分。改为由前端传入本次操作的 requestId。
        String requestKey = request.requestId() == null ? "" : request.requestId().trim();
        String idempotencyKey = requestKey.isEmpty()
                ? "manual:" + student.getId() + ":" + UUID.randomUUID()
                : "manual:" + student.getId() + ":" + requestKey;
        if (!requestKey.isEmpty() && ledgerRepository.existsByIdempotencyKey(idempotencyKey)) {
            // 同一笔操作已经记过账：直接回当前余额，不再加一次
            return StudentPointsResponse.from(student);
        }

        int balanceAfter = student.getTotalPoints() + amount;
        if (balanceAfter < 0) {
            throw new BusinessException("POINTS_NOT_ENOUGH", "扣减后积分不能小于0");
        }
        if (balanceAfter > MAX_POINTS) {
            throw new BusinessException(
                    "INVALID_POINTS",
                    "调整后积分不能超过" + MAX_POINTS
            );
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
        ledger.setIdempotencyKey(idempotencyKey);
        ledgerRepository.save(ledger);

        return StudentPointsResponse.from(student);
    }

    @Transactional(readOnly = true)
    public StudentPointsDetailResponse getStudentPoints(
            Long studentId
    ) {
        AppUser teacher = requireTeacher();
        Student student = getOwnedStudent(teacher.getId(), studentId);
        List<StudentPointsLedger> ledgers =
                ledgerRepository.findByStudentIdOrderByCreatedAtDesc(student.getId());
        Map<String, String> gameNameByCode = buildGameNameMap(ledgers);
        List<PointsLedgerResponse> ledgerResponses = ledgers.stream()
                .map(ledger -> PointsLedgerResponse.from(ledger, gameNameByCode))
                .toList();
        return new StudentPointsDetailResponse(
                StudentResponse.from(student),
                ledgerResponses
        );
    }

    /**
     * 批量把流水里出现的 gameCode 映射成游戏名称（含手动导入的游戏）。
     * 未登记的 gameCode 返回 null，前端做兜底展示。
     */
    private Map<String, String> buildGameNameMap(List<StudentPointsLedger> ledgers) {
        List<String> codes = ledgers.stream()
                .map(StudentPointsLedger::getGameCode)
                .filter(code -> code != null && !code.isBlank())
                .distinct()
                .toList();
        if (codes.isEmpty()) {
            return Map.of();
        }
        // 原先每个 code 单独 findByGameCode 一次（注释却写着"避免逐条查询"）。
        // 一个学生的流水里往往有十几个不同游戏，这里一次 IN 查询取完。
        Map<String, String> result = new LinkedHashMap<>();
        for (GameProduct product : gameProductRepository.findByGameCodeIn(codes)) {
            result.put(product.getGameCode(), product.getName());
        }
        return result;
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
        student.setClassName(normalizeClassName(className));
        student.setTotalPoints(initialPoints);
        student.setVersion(0L);
        student = studentRepository.saveAndFlush(student);

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
            StudentRow row,
            Set<String> fileStudentKeys,
            Set<String> existingKeys
    ) {
        List<String> errors = new ArrayList<>();
        String name = row.name() == null ? "" : row.name().trim();
        String studentNo = row.studentNo() == null ? "" : row.studentNo().trim();
        String className = normalizeClassName(row.className());

        if (name.isBlank()) {
            errors.add("姓名不能为空");
        }
        if (studentNo.isBlank()) {
            errors.add("学号不能为空");
        } else {
            if (studentNo.length() > 64) {
                errors.add("学号不能超过64位");
            }
            String key = classStudentKey(className, studentNo);
            if (!fileStudentKeys.add(key)) {
                errors.add("同一班级内学号重复");
            }
            if (existingKeys.contains(key)) {
                errors.add("该班级下学号已存在");
            }
        }

        if (className.length() > 64) {
            errors.add("班级不能超过64位");
        }
        if (row.initialPoints() < 0 || row.initialPoints() > 99999) {
            errors.add("初始积分应在0到99999之间");
        }
        return errors;
    }

    private String normalizeClassName(String className) {
        if (className == null || className.isBlank()) {
            return "未分班";
        }
        return className.trim();
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
            int lastRow = sheet.getLastRowNum();
            if (lastRow > MAX_IMPORT_ROWS) {
                throw new BusinessException(
                        "TOO_MANY_ROWS",
                        "单次最多导入 " + MAX_IMPORT_ROWS + " 行，当前表格有 " + lastRow + " 行"
                );
            }
            for (int rowIndex = 1; rowIndex <= lastRow; rowIndex++) {
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

    /**
     * 解析单元格里的整数。
     *
     * <p>原先是裸 {@code Integer.parseInt}：表格里写 {@code 1.5}、
     * {@code 1,000}、{@code 10 分} 都会抛异常，而异常一路冒到最外层 ——
     * **整批导入失败**，用户只看到「第 5 行初始积分不是有效整数」，
     * 前面 4 行也一起白导了。这里改成尽量理解人的写法：去掉千分位与空白，
     * 小数部分为 0 时按整数取，其余才算错。
     */
    private int parseInt(String text, int rowNumber) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        String cleaned = text.trim()
                .replace(",", "")
                .replace("，", "")
                .replace(" ", "")
                .replace("分", "");
        try {
            return Integer.parseInt(cleaned);
        } catch (NumberFormatException ignored) {
            // 继续尝试按小数解析
        }
        try {
            java.math.BigDecimal value = new java.math.BigDecimal(cleaned);
            if (value.stripTrailingZeros().scale() > 0) {
                throw new ArithmeticException("not an integer");
            }
            return value.intValueExact();
        } catch (RuntimeException ex) {
            throw new BusinessException(
                    "INVALID_POINTS",
                    "第" + rowNumber + "行初始积分不是有效整数（当前值：" + text.trim() + "）"
            );
        }
    }

    private AppUser requireTeacher() {
        AppUser user = AuthContext.requireUser();
        if (!"TEACHER".equals(user.getRole())) {
            throw new BusinessException("FORBIDDEN", "只有教师账号可以管理学生");
        }
        return user;
    }

    private Student getOwnedStudent(Long teacherId, Long studentId) {
        return studentRepository.findByIdAndTeacherId(studentId, teacherId)
                .orElseThrow(() -> new NotFoundException("学生不存在或不属于当前教师"));
    }

    /** 加行锁版本，用于所有「读积分 → 计算 → 写回」的场景。 */
    private Student getOwnedStudentForUpdate(Long teacherId, Long studentId) {
        return studentRepository.findForUpdateByIdAndTeacherId(studentId, teacherId)
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

    public record UpdateStudentRequest(
            String name,
            String studentNo,
            String className,
            Integer totalPoints
    ) {
    }

    public record AdjustPointsRequest(
            int amount,
            String reason,
            /**
             * 本次操作的客户端唯一标识（前端每次点击生成一个 UUID）。
             * 重试时带上同一个值即可保证只加一次分；不带则退化为「每次都记一笔」。
             */
            String requestId
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
            String gameCode,
            String gameName,
            String createdAt
    ) {
        public static PointsLedgerResponse from(
                StudentPointsLedger ledger,
                Map<String, String> gameNameByCode
        ) {
            String gameCode = ledger.getGameCode();
            return new PointsLedgerResponse(
                    ledger.getId(),
                    ledger.getChangeType(),
                    ledger.getAmount(),
                    ledger.getBalanceAfter(),
                    ledger.getBizType(),
                    gameCode,
                    gameCode == null ? null : gameNameByCode.get(gameCode),
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
