update student
set class_name = '未分班'
where class_name is null or trim(class_name) = '';

alter table student
    alter column class_name set default '未分班';

alter table student
    alter column class_name set not null;

alter table student
    drop constraint uk_student_teacher_no;

alter table student
    add constraint uk_student_teacher_class_no unique (teacher_id, class_name, student_no);

