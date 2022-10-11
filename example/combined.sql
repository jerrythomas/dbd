set search_path to config, extensions;

create table if not exists lookups (
  id                uuid primary key default uuid_generate_v4()
, name              varchar(30)
, modified_on       timestamp not null default now()
, modified_by       varchar
);
create unique index if not exists lookup_ukey on lookups(name);
comment on table lookups IS 'Generic lookup table for various lookups.';
set search_path to config, extensions;

create table if not exists lookup_values (
  id                uuid primary key default uuid_generate_v4()
, lookup_id         uuid references lookups(id)
, value             varchar(255)
, details           jsonb
, sequence          integer
, exclude           boolean default false
, is_active         boolean default true
, modified_on       timestamp not null default now()
, modified_by       varchar
);

create unique index if not exists lookup_values_ukey on lookup_values(lookup_id, value);
comment on table lookup_values IS 'Different values associated with the lookup.';