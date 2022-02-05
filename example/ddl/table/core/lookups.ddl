set search_path to core, public, extensions;

create table if not exists lookups (
  id                uuid primary key default uuid_generate_v4()
, name              varchar(30)
, modified_on       timestamp not null default now()
, modified_by       uuid
);
create unique index if not exists lookup_ukey on lookups(name);
comment on table lookups IS 'Generic lookup table for various lookups.';