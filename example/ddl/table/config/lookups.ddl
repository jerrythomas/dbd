set search_path to config, extensions;

create table if not exists lookups (
  id                       uuid primary key default uuid_generate_v4()
, name                     varchar(30)
, is_editable              boolean default true
, icon                     varchar
, description              text
, modified_on              timestamp with time zone not null default now()
, modified_by              varchar
);
create unique index if not exists lookup_ukey on lookups(name);

comment on table lookups IS 'Generic lookup table for various lookups.';

comment on column lookups.id IS 'Unique identifier for the lookup.';
comment on column lookups.name IS 'Name of the lookup.';
comment on column lookups.description IS 'Description of the lookup.';
comment on column lookups.icon IS 'Icon to be used for the lookup.';
comment on column lookups.is_editable IS 'Flag indicating whether this lookup is editable.';
comment on column lookups.modified_on IS 'Date and time the lookup entry was last modified.';
comment on column lookups.modified_by IS 'User that last modified the lookup entry.';
