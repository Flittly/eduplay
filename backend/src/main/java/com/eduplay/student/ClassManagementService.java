package com.eduplay.student;

import com.eduplay.auth.AuthContext;

import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@Profile("local")
public class ClassManagementService {

    private final StudentRepository studentRepository;
    private final TeacherClassRepository classRepository;
    private final StudentPointsLedgerRepository ledgerRepository;

    public ClassManagementService(
            StudentRepository studentRepository,
            TeacherClassRepository classRepository,
            StudentPointsLedgerRepository ledgerRepository
    ) {
        this.studentRepository = studentRepository;
        this.classRepository = classRepository;
        this.ledgerRepository = ledgerRepository;
    }

    @Transactional(readOnly = true)
    public List<ClassSummary> listClasses() {
        AppUser teacher = requireTeacher();
        // 学生名单只查一次，再按班级名（忽略大小写）分组。
        // 原先每个班都要单独查两次（学生 + 班委），10 个班就是 20 次查询。
        List<Student> allStudents =
                studentRepository.findByTeacherIdOrderByClassNameAscNameAsc(teacher.getId());
        Map<String, List<Student>> studentsByClass = new LinkedHashMap<>();
        for (Student student : allStudents) {
            studentsByClass
                    .computeIfAbsent(classKey(student.getClassName()), key -> new ArrayList<>())
                    .add(student);
        }

        Map<String, String> monitorByClass = new HashMap<>();
        Set<String> names = new LinkedHashSet<>();
        for (TeacherClass record : classRepository.findByTeacherIdOrderByClassNameAsc(teacher.getId())) {
            names.add(record.getClassName());
            monitorByClass.putIfAbsent(classKey(record.getClassName()), record.getMonitorName());
        }
        names.addAll(allStudents.stream().map(Student::getClassName).toList());

        return names.stream()
                .sorted(Comparator.naturalOrder())
                .map(name -> toSummary(
                        name,
                        studentsByClass.getOrDefault(classKey(name), List.of()),
                        monitorByClass.get(classKey(name))
                ))
                .toList();
    }

    /** 班级名比较一律忽略大小写，与 IgnoreCase 查询保持同一口径。 */
    private static String classKey(String className) {
        return className == null ? "" : className.toLowerCase(java.util.Locale.ROOT);
    }

    @Transactional
    public ClassSummary setMonitor(
            String className,
            String monitorName
    ) {
        AppUser teacher = requireTeacher();
        String normalized = normalize(className);
        TeacherClass record = classRepository
                .findByTeacherIdAndClassNameIgnoreCase(teacher.getId(), normalized)
                .orElseGet(() -> {
                    TeacherClass created = new TeacherClass();
                    created.setTeacherId(teacher.getId());
                    created.setClassName(normalized);
                    created.setCreatedAt(Instant.now());
                    created.setUpdatedAt(Instant.now());
                    return created;
                });
        record.setMonitorName(
                monitorName == null || monitorName.isBlank()
                        ? null
                        : monitorName.trim()
        );
        record.setUpdatedAt(Instant.now());
        classRepository.save(record);
        return toSummary(
                normalized,
                studentRepository.findByTeacherIdAndClassNameIgnoreCase(teacher.getId(), normalized),
                record.getMonitorName()
        );
    }

    @Transactional
    public void deleteClass(String className) {
        AppUser teacher = requireTeacher();
        String normalized = normalize(className);
        List<Student> students =
                studentRepository.findByTeacherIdAndClassNameIgnoreCase(
                        teacher.getId(),
                        normalized
                );
        List<TeacherClass> records =
                classRepository.findAllByTeacherIdAndClassNameIgnoreCase(
                        teacher.getId(),
                        normalized
                );
        // 只设过班委、还没加学生的班级也必须能删。
        // 原先「students.isEmpty() 就 404」，这类班级永远删不掉，
        // 界面上一直留着一个删不掉的空壳。
        if (students.isEmpty() && records.isEmpty()) {
            throw new NotFoundException("班级不存在");
        }

        if (!students.isEmpty()) {
            // 一次性删整批流水（原先逐个 deleteByStudentId）
            ledgerRepository.deleteByStudentIdIn(
                    students.stream().map(Student::getId).toList()
            );
            // ⚠ 按实体删，不再用 deleteByTeacherIdAndClassName：
            // 那个派生方法是**区分大小写**的，而上面查学生用的是 IgnoreCase。
            // 班名写成 "Class 1"、记录里是 "class 1" 时，学生查得到、删不掉，
            // 随后外键约束把整个删除打成 500。
            studentRepository.deleteAll(students);
            studentRepository.flush();
        }
        if (!records.isEmpty()) {
            classRepository.deleteAll(records);
        }
    }

    private ClassSummary toSummary(
            String className,
            List<Student> students,
            String monitorName
    ) {
        int count = students.size();
        long totalPoints = students.stream()
                .mapToLong(Student::getTotalPoints)
                .sum();
        double avgPoints = count == 0 ? 0 : Math.round(totalPoints * 10.0 / count) / 10.0;
        int maxPoints = students.stream()
                .mapToInt(Student::getTotalPoints)
                .max()
                .orElse(0);
        List<String> topStudents = students.stream()
                .filter(student -> student.getTotalPoints() == maxPoints)
                .map(Student::getName)
                .sorted()
                .toList();
        return new ClassSummary(
                className,
                count,
                monitorName,
                avgPoints,
                count == 0 ? null : maxPoints,
                topStudents
        );
    }

    private String normalize(String className) {
        if (className == null || className.isBlank()) {
            return "未分班";
        }
        return className.trim();
    }

    private AppUser requireTeacher() {
        AppUser user = AuthContext.requireUser();
        if (!"TEACHER".equals(user.getRole())) {
            throw new NotFoundException("只有教师可以管理班级");
        }
        return user;
    }

    public record ClassSummary(
            String className,
            int studentCount,
            String monitorName,
            double avgPoints,
            Integer maxPoints,
            List<String> topStudents
    ) {
    }
}
