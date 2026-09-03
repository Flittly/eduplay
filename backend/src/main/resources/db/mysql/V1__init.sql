create table app_user (
    id bigint auto_increment primary key,
    username varchar(64) not null unique,
    nickname varchar(64),
    user_type varchar(16) not null default 'GUEST',
    created_at timestamp not null,
    updated_at timestamp not null
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

create table points_account (
    id bigint auto_increment primary key,
    user_id bigint not null unique,
    balance int not null default 0,
    version bigint not null default 0,
    updated_at timestamp not null
);

create table points_ledger (
    id bigint auto_increment primary key,
    account_id bigint not null,
    user_id bigint not null,
    change_type varchar(32) not null,
    amount int not null,
    balance_after int not null,
    biz_type varchar(32) not null,
    biz_id varchar(64) not null,
    idempotency_key varchar(64) not null unique,
    created_at timestamp not null
);

create table game_session (
    id bigint auto_increment primary key,
    user_id bigint not null,
    game_id bigint not null,
    session_no varchar(64) not null unique,
    score int not null default 0,
    correct_count int not null default 0,
    total_count int not null default 0,
    status varchar(16) not null,
    client_version varchar(32),
    started_at timestamp not null,
    finished_at timestamp,
    constraint fk_game_session_user foreign key (user_id) references app_user(id),
    constraint fk_game_session_game foreign key (game_id) references game_product(id)
);

insert into game_product(
    game_code,
    name,
    description,
    cover_url,
    price_cents,
    status,
    version,
    entry,
    created_at,
    updated_at
) values (
    'province_puzzle',
    '行政区拼图',
    '拖动省级行政区到地图上的正确位置，认识中国省级行政区。',
    null,
    0,
    'ACTIVE',
    '0.1.0',
    'province_puzzle',
    current_timestamp,
    current_timestamp
);
