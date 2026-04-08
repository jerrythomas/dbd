set search_path to config;

create table if not exists items (
  id   uuid primary key default uuid_generate_v4()
, name varchar not null
);
