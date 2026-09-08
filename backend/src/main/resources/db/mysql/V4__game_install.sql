create table user_game_install (
    id bigint auto_increment primary key,
    user_id bigint not null,
    game_id bigint not null,
    installed_version varchar(32) not null,
    status varchar(16) not null,
    installed_at timestamp not null,
    updated_at timestamp not null,
    constraint fk_user_game_install_user foreign key (user_id) references app_user(id),
    constraint fk_user_game_install_game foreign key (game_id) references game_product(id),
    constraint uk_user_game_install unique (user_id, game_id)
);
