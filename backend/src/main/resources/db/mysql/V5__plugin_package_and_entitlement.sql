update game_product
set price_cents = 990
where game_code = 'province_puzzle';

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

insert into activation_code(game_code, code, status, created_at)
values ('province_puzzle', 'PROVINCE-PUZZLE-2026', 'UNUSED', current_timestamp);

insert into game_package(game_id, version, package_name, status, created_at)
select id, version, concat('province_puzzle-', version, '.zip'), 'PUBLISHED', current_timestamp
from game_product
where game_code = 'province_puzzle';
