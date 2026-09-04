create table app_user (
    id bigint auto_increment primary key,
    username varchar(64) not null unique,
    nickname varchar(64),
    user_type varchar(16) not null default 'GUEST',
    password_hash varchar(255),
    role varchar(16) not null default 'STUDENT',
    status varchar(16) not null default 'ACTIVE',
    student_no varchar(64),
    class_name varchar(64),
    created_at timestamp not null,
    updated_at timestamp not null
);

create table local_session (
    id bigint auto_increment primary key,
    user_id bigint not null,
    token varchar(128) not null unique,
    expires_at timestamp not null,
    created_at timestamp not null,
    constraint fk_local_session_user foreign key (user_id) references app_user(id)
);

create table game_product (
    id bigint auto_increment primary key,
    game_code varchar(64) not null unique,
    name varchar(128) not null,
    description varchar(512),
    cover_url varchar(512),
    price_cents int not null default 0,
    status varchar(16) not null default 'ACTIVE',
    version varchar(32) not null,
    entry varchar(255),
    created_at timestamp not null,
    updated_at timestamp not null
);

create table game_package (
    id bigint auto_increment primary key,
    game_id bigint not null,
    version varchar(32) not null,
    package_name varchar(128) not null,
    sha256 varchar(64),
    size_bytes bigint,
    status varchar(16) not null default 'PUBLISHED',
    created_at timestamp not null,
    constraint fk_game_package_game foreign key (game_id) references game_product(id),
    constraint uk_game_package_game_version unique (game_id, version)
);

create table activation_code (
    id bigint auto_increment primary key,
    game_code varchar(64) not null,
    code varchar(64) not null unique,
    status varchar(16) not null default 'UNUSED',
    used_by_user_id bigint,
    used_at timestamp,
    created_at timestamp not null,
    constraint fk_activation_code_user foreign key (used_by_user_id) references app_user(id)
);

create table user_entitlement (
    id bigint auto_increment primary key,
    user_id bigint not null,
    game_id bigint not null,
    source varchar(32) not null,
    status varchar(16) not null default 'ACTIVE',
    granted_at timestamp not null,
    updated_at timestamp not null,
    constraint fk_user_entitlement_user foreign key (user_id) references app_user(id),
    constraint fk_user_entitlement_game foreign key (game_id) references game_product(id),
    constraint uk_user_entitlement unique (user_id, game_id)
);
