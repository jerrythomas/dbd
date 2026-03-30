set search_path to config, extensions;

create table if not exists categories (
  id          uuid primary key default uuid_generate_v4()
, name        varchar(100) not null
, parent_id   uuid references categories(id)
);
