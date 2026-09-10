create table app_settings (
    setting_key varchar(64) primary key,
    setting_value varchar(1024) not null,
    updated_at timestamp not null default current_timestamp
);
