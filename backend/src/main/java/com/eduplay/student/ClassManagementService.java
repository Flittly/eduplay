package com.eduplay.student;

import com.eduplay.auth.AuthService;
import com.eduplay.common.NotFoundException;
import com.eduplay.user.AppUser;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
@Profile("local")
public class ClassManagementService {

    private final AuthService authService;
    private final StudentRepository studentRepository;
    private final TeacherClassRepository classRepository;
    private final StudentPointsLedgerRepository ledgerRepository;

    public ClassManagementService(
            AuthService authService,
            StudentRepository studentRepository,
            TeacherClassRepository classRepository,
            StudentPointsLedgerRepository ledgerRepository
    ) {
        this.authService = authService;
        this.studentRepository = studentRepository;
        this.classRepository = classRepository;
        this.ledgerRepository = ledgerRepository;
    }

    @Transactional(readOnly = true)
    public List<ClassSummary> listClasses(String authorization) {
        AppUser teacher = requireTeacher(authorization);
        Set<String> names = new LinkedHashSet<>();
        classRepository.findByTeacherIdOrderByClassNameAsc(teacher.getId())
                .forEach(item -> names.add(item.getClassName()));
        studentRepository
                .findByTeacherIdOrderByClassNameAscNameAsc(teacher.getId())
                .forEach(student -> names.add(student.getClassName()));

        return names.stream()
                .sorted(Comparator.naturalOrder())
                .map(name -> toSummary(teacher.getId(), name))
                .toList();
    }

    @Transactional
    public ClassSummary setMonitor(
            String authorization,
            String className,
            String monitorName
    ) {
        AppUser teacher = requireTeacher(authorization);
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
        return toSummary(teacher.getId(), normalized);
    }

    @Transactional
    public void deleteClass(String authorization, String className) {
        AppUser teacher = requireTeacher(authorization);
        String normalized = normalize(className);
        List<Student> students =
                studentRepository.findByTeacherIdAndClassNameIgnoreCase(
                        teacher.getId(),
                        normalized
                );
        if (students.isEmpty()) {
            throw new NotFoundException("班级不存在或没有学生");
        }
        for (Student student : students) {
            ledgerRepository.deleteByStudentId(student.getId());
        }
        studentRepository.deleteByTeacherIdAndClassName(
                teacher.getId(),
                normalized
        );
        classRepository.deleteByTeacherIdAndClassName(
                teacher.getId(),
                normalized
        );
    }

    private ClassSummary toSummary(Long teacherId, String className) {
        List<Student> students =
                studentRepository.findByTeacherIdAndClassNameIgnoreCase(
                        teacherId,
                        className
                );
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
        TeacherClass record = classRepository
                .findByTeacherIdAndClassNameIgnoreCase(teacherId, className)
                .orElse(null);
        return new ClassSummary(
                className,
                count,
                record == null ? null : record.getMonitorName(),
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

    private AppUser requireTeacher(String authorization) {
        AppUser user = authService.requireUser(authorization);
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
