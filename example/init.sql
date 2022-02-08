create schema if not exists core;
create schema if not exists extensions;
create schema if not exists staging;
create extension if not exists "uuid-ossp" with schema public;
create role basic inherit;
create role advanced inherit;
grant basic to advanced;
set search_path to core, public, extensions;

create table if not exists lookups (
  id                uuid primary key default uuid_generate_v4()
, name              varchar(30)
, modified_on       timestamp not null default now()
, modified_by       uuid
);
create unique index if not exists lookup_ukey on lookups(name);
comment on table lookups IS 'Generic lookup table for various lookups.';
set search_path to staging;

create table if not exists lookup_values (
  lookup_name       varchar
, value             varchar
, description       text
, is_active         boolean
);
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
set search_path to core;

create or replace view genders
as
select lv.id
     , lv.value
		 , lv.description
		 , lv.is_active
  from lookups  lkp
 inner join lookup_values lv
    on lv.lookup_id = lkp.id
 where lkp.name = 'Gender';