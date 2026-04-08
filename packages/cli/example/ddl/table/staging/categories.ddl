set search_path to staging;

create table if not exists categories
(
  name        varchar(100)
, parent_name varchar(100)
);

create unique index if not exists categories_ukey
    on categories (name);
