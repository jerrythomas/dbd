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
