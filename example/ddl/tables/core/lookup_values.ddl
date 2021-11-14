set search_path to core, public, extensions;

create table if not exists lookup_values (
  id                uuid primary key default uuid_generate_v4()
, lookup_id         uuid references lookups(id)
, value             varchar(255)
, description       text
, is_active         boolean default true
, modified_on       timestamp not null default now()
, modified_by       uuid
);

create unique index if not exists lookup_values_ukey on lookup_values(lookup_id, value);
comment on table lookup_values IS 'Different values associated with the lookup.';