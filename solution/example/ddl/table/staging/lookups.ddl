set search_path to staging;

create table if not exists lookups
(
  name                     varchar
, is_editable              boolean
, icon                     varchar
, description              varchar
, modified_on              timestamp with time zone default now()
, modified_by              varchar default current_user
);

create unique index if not exists lookups_ukey
    on lookups (name);
