create table student (
    id bigint auto_increment primary key,
    teacher_id bigint not null,
    student_no varchar(64) not null,
    name varchar(64) not null,
    class_name varchar(64),
    total_points int not null default 0,
    version bigint not null default 0,
    created_at timestamp not null,
    updated_at timestamp not null,
    constraint fk_student_teacher foreign key (teacher_id) references app_user(id),
    constraint uk_student_teacher_no unique (teacher_id, student_no)
);

create table student_points_ledger (
    id bigint auto_increment primary key,
    student_id bigint not null,
    teacher_id bigint not null,
    change_type varchar(32) not null,
    amount int not null,
    balance_after int not null,
    biz_type varchar(32) not null,
    biz_id varchar(64) not null,
    idempotency_key varchar(64) not null unique,
    created_at timestamp not null,
    constraint fk_student_ledger_student foreign key (student_id) references student(id),
    constraint fk_student_ledger_teacher foreign key (teacher_id) references app_user(id)
);
