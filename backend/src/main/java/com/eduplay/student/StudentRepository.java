package com.eduplay.student;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StudentRepository extends JpaRepository<Student, Long> {

    List<Student> findByTeacherIdOrderByClassNameAscNameAsc(Long teacherId);

    List<Student> findByTeacherIdAndClassNameIgnoreCaseOrderByNameAsc(
            Long teacherId,
            String className
    );

    List<Student> findByTeacherIdAndNameContainingIgnoreCaseOrderByNameAsc(
            Long teacherId,
            String keyword
    );

    Optional<Student> findByIdAndTeacherId(Long id, Long teacherId);

    boolean existsByTeacherIdAndClassNameAndStudentNo(
            Long teacherId,
            String className,
            String studentNo
    );

    boolean existsByTeacherIdAndClassNameAndStudentNoAndIdNot(
            Long teacherId,
            String className,
            String studentNo,
            Long id
    );
}
