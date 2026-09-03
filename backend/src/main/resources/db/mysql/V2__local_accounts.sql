alter table app_user
    add column password_hash varchar(255);

alter table app_user
    add column role varchar(16) not null default 'STUDENT';

alter table app_user
    add column student_no varchar(64);

alter table app_user
    add column class_name varchar(64);

create unique index uk_app_user_student_no on app_user(student_no);

create table local_session (
    id bigint auto_increment primary key,
    user_id bigint not null,
    token varchar(128) not null unique,
    expires_at timestamp not null,
    created_at timestamp not null,
    constraint fk_local_session_user foreign key (user_id) references app_user(id)
);
