update student
set class_name = '未分班'
where class_name is null or trim(class_name) = '';

alter table student
    modify class_name varchar(64) not null default '未分班';

create index idx_student_teacher_id on student(teacher_id);

alter table student
    drop index uk_student_teacher_no;

alter table student
    add unique index uk_student_teacher_class_no (teacher_id, class_name, student_no);
