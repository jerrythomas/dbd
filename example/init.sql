create schema if not exists config;
create schema if not exists extensions;
create schema if not exists staging;
create schema if not exists migrate;
create extension if not exists "uuid-ossp" with schema extensions;
DO
$do$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                   WHERE rolname = 'basic') THEN
      CREATE ROLE basic;
   END IF;
END
$do$;

DO
$do$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                   WHERE rolname = 'advanced') THEN
      CREATE ROLE advanced;
   END IF;
END
$do$;
grant basic to advanced;
set search_path to staging;

drop procedure if exists import_jsonb_to_table;
create or replace procedure import_jsonb_to_table(source varchar, target varchar)
language plpgsql as $$
declare
    type_definition text;
    dyn_sql         text;
begin

    -- construct type definition dynamically from target table columns
    select string_agg(column_name || ' ' || data_type, ', ')
      into type_definition
      from information_schema.columns
     where table_schema = split_part(target, '.', 1)
       and table_name   = split_part(target, '.', 2);

    -- Construct dynamic SQL for the INSERT operation
    dyn_sql := format(
        'insert into %s select rec.* from %s, lateral jsonb_to_record(data::jsonb) as rec(%s)',
        target, source, type_definition
    );

    -- Execute dynamic SQL
    execute dyn_sql;
end;
$$;

set search_path to config, extensions;

create table if not exists lookups (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar(30)
, modified_on              timestamp with time zone not null default now()
, modified_by              varchar
);
create unique index if not exists lookup_ukey on lookups(name);

comment on table lookups IS 'Generic lookup table for various lookups.';

comment on column lookups.id IS 'Unique identifier for the lookup.';
comment on column lookups.name IS 'Name of the lookup.';
comment on column lookups.modified_on IS 'Date and time the lookup entry was last modified.';
comment on column lookups.modified_by IS 'User that last modified the lookup entry.';

set search_path to staging;
create table if not exists lookup_values(
  name                     varchar
, value                    varchar
, details                  jsonb
, is_active                boolean
, sequence                 integer
, exclude                  boolean default false
, modified_on              timestamp
, modified_by              varchar
);

set search_path to config, extensions;

create table if not exists lookup_values (
  id                       uuid primary key default uuid_generate_v4()
, lookup_id                uuid references lookups(id)
, value                    varchar(255)
, details                  jsonb
, sequence                 integer
, exclude                  boolean default false
, is_active                boolean default true
, modified_on              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists lookup_values_ukey on lookup_values(lookup_id, value);

comment on table lookup_values IS 'Different values associated with the lookup.';

comment on column lookup_values.id IS 'Unique identifier for the lookup value.';
comment on column lookup_values.lookup_id IS 'Unique identifier for the lookup.';
comment on column lookup_values.value IS 'Value associated with the lookup.';
comment on column lookup_values.details IS 'Details associated with the lookup value. This allows custom attributes to be defined for the lookup value.';
comment on column lookup_values.sequence IS 'Sequence number for the lookup value.';
comment on column lookup_values.exclude IS 'Flag indicating whether the lookup value should be excluded from the lookup.';
comment on column lookup_values.is_active IS 'Flag indicating whether the lookup value is active.';
comment on column lookup_values.modified_on IS 'Date and time the lookup value was last modified.';
comment on column lookup_values.modified_by IS 'User that last modified the lookup value.';

set search_path to staging;

create or replace procedure import_lookups()
language plpgsql
as
$$
begin
  insert into config.lookups(name, modified_on, modified_by)
  select distinct name
       , first_value(modified_on)  over (partition by name order by modified_on)
       , coalesce(first_value(modified_by) over (partition by name order by modified_on), current_user)
    from staging.lookup_values slv
   where not exists (select 1
                       from config.lookups lkp
                      where lkp.name = slv.name);

  update config.lookup_values lv
     set ( sequence
         , details
         , modified_by
         , modified_on
         ) = (select slv.sequence
                   , slv.details
                   , coalesce(slv.modified_by,current_user)
                   , slv.modified_on
                from staging.lookup_values slv
               inner join config.lookups lkp
                  on lkp.name  = slv.name
               where slv.value = lv.value
                 and lkp.id    = lv.lookup_id )
   where exists
        (select 1
           from staging.lookup_values slv
          inner join config.lookups lkp
             on lkp.name  = slv.name
          where slv.value = lv.value
            and lkp.id    = lv.lookup_id);

  insert into config.lookup_values(
     lookup_id
   , value
   , sequence
   , exclude
   , details
   , is_active
   , modified_on
   , modified_by)
  select distinct
         lkp.id
       , slv.value
       , slv.sequence
       , slv.exclude
       , slv.details
       , slv.is_active
       , slv.modified_on
       , coalesce(slv.modified_by,current_user)
    from staging.lookup_values slv
   inner join config.lookups lkp
      on lkp.name = slv.name
   where not exists
            (select 1
               from config.lookup_values lkv
              where lkv.lookup_id = lkp.id
                and lkv.value     = slv.value);

end;
$$

set search_path to config;

create or replace view genders
as
select lv.id
     , lv.value
     , lv.is_active
  from lookups  lkp
 inner join lookup_values lv
    on lv.lookup_id = lkp.id
 where lkp.name = 'Gender';

set search_path to migrate;

create or replace view lookup_values
as
select lkp.name
     , lkv.value
     , lkv.details
     , lkv.is_active
     , lkv.modified_on
     , lkv.modified_by
  from config.lookups lkp
 inner join config.lookup_values lkv
    on lkp.id = lkv.lookup_id;