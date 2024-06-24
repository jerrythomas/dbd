set search_path to core, config;

create table if not exists users (
  id                       uuid primary key default uuid_generate_v4()
, username                 varchar not null
, email                    varchar not null unique
, role_id                  uuid references lookup_values(id)
, created_at               timestamp not null default now()
, updated_at               timestamp not null default now()
);
