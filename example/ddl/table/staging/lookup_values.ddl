set search_path to staging;

create table if not exists lookup_values (
  lookup_name       varchar
, value             varchar
, description       text
, is_active         boolean
);