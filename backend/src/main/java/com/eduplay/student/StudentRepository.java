package com.eduplay.student;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    /**
     * 取学生并**加行锁**（{@code SELECT ... FOR UPDATE}）。
     *
     * <p>积分是「读 totalPoints → 加 → 写」：两个请求同时读到 100，都加 10，
     * 后提交的那个把前一个覆盖掉（或者抛乐观锁异常变成 500）。
     * 学生表上有 {@code @Version}，冲突时抛 {@code ObjectOptimisticLockingFailureException}，
     * 而所有调用方都没有重试 —— 双击「+10」必有一个失败。
     *
     * <p>用行锁把这段临界区串起来，比加重试简单，也能顺带修好
     * 「积分流水幂等键 check-then-act」——同一个学生的结算天然串行。
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Student s where s.id = :id and s.teacherId = :teacherId")
    Optional<Student> findForUpdateByIdAndTeacherId(
            @Param("id") Long id,
            @Param("teacherId") Long teacherId
    );

    /** 该教师名下所有「班级 + 学号」对，导入时一次性预取用于判重。 */
    @Query("select s.className, s.studentNo from Student s where s.teacherId = :teacherId")
    List<Object[]> findClassStudentKeys(@Param("teacherId") Long teacherId);

    List<Student> findByTeacherIdAndClassNameIgnoreCase(Long teacherId, String className);

    void deleteByTeacherIdAndClassName(Long teacherId, String className);

    long countByTeacherId(Long teacherId);

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
