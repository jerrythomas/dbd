set search_path to staging;
create table if not exists lookup_values(
	name                     varchar
, value                    varchar
, sequence                 integer
, is_active                boolean default true
, is_hidden                boolean default false
, details                  jsonb
, description              text
, modified_on              timestamp
, modified_by              varchar
);

create unique index if not exists lookup_values_ukey
    on lookup_values(name,value);
