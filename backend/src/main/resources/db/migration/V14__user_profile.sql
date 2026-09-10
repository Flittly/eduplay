alter table app_user
    add column phone varchar(32);

alter table app_user
    add column email varchar(128);

alter table app_user
    add column gender varchar(16);

alter table app_user
    add column birthday date;
