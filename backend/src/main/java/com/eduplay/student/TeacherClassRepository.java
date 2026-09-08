package com.eduplay.student;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TeacherClassRepository extends JpaRepository<TeacherClass, Long> {

    List<TeacherClass> findByTeacherIdOrderByClassNameAsc(Long teacherId);

    Optional<TeacherClass> findByTeacherIdAndClassNameIgnoreCase(
            Long teacherId,
            String className
    );

    void deleteByTeacherIdAndClassName(Long teacherId, String className);
}
