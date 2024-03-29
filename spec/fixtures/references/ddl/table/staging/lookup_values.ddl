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