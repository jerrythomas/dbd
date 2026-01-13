// dbd/example/spec/fixtures/parser/ddl-samples.js
// This file contains sample DDL scripts for testing SQL parsing

// Table definitions
export const lookupTableDDL = `
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

comment on table lookups IS
'Generic lookup table for various lookups.';

comment on column lookups.id IS
'Unique identifier for the lookup. Ensures each lookup can be uniquely identified.';

comment on column lookups.name IS
'Name of the lookup. Used to identify the lookup.';

comment on column lookups.is_editable IS
'Flag indicating whether this lookup is editable.';

comment on column lookups.icon IS
'Icon to be used for the lookup.';

comment on column lookups.description IS
'Description of the lookup. Provides additional details about the lookup.';

comment on column lookups.modified_on IS
'Date and time the lookup entry was last modified. Provides a history of when changes were made.';

comment on column lookups.modified_by IS
'User that last modified the lookup entry. Tracks who made the changes for auditing purposes.';
`

export const lookupValueTableDDL = `
set search_path to config, extensions;

create table if not exists lookup_values (
  id                       uuid primary key default uuid_generate_v4()
, lookup_id                uuid references lookups(id)
, value                    varchar(255)
, sequence                 integer
, is_active                boolean default true
, is_hidden                boolean default false
, details                  jsonb
, description              text
, modified_on              timestamp with time zone not null default now()
, modified_by              varchar
);

create unique index if not exists lookup_values_ukey on lookup_values(lookup_id, value);

comment on table lookup_values IS
'Different values associated with various lookups.
- Used to store predefined values for different lookup categories.
- Each value is associated with a specific lookup.';

comment on column lookup_values.id IS
'Unique identifier for the lookup value. Ensures each value can be uniquely identified.';

comment on column lookup_values.lookup_id IS
'Identifier for the lookup category. References the lookups table to specify the category.';

comment on column lookup_values.value IS
'The actual value associated with the lookup.';

comment on column lookup_values.sequence IS
'Order of the value within the lookup category. Used for sorting purposes.';

comment on column lookup_values.is_active IS
'Flag indicating if the lookup value is active. Used to determine if the value is currently in use.';

comment on column lookup_values.is_hidden IS
'Flag indicating if the lookup value should be hidden. Used to exclude the value from display.';

comment on column lookup_values.details IS
'Additional details associated with the lookup value. Stored as a JSONB field to accommodate various attributes.';

comment on column lookup_values.description IS
'Description of the lookup value. Provides additional context about the value.';

comment on column lookup_values.modified_on IS
'The date the lookup value was last modified. Provides a history of when changes were made.';

comment on column lookup_values.modified_by IS
'The user who last modified the lookup value. Tracks who made the changes for auditing purposes.';
`

export const stagingLookupValueTableDDL = `
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
`

// View definitions
export const gendersViewDDL = `
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
`

export const rangeValuesViewDDL = `
set search_path to config;

create or replace view range_values
as
select lv.id
     , lv.value
     , (lv.details ->> 'lower_bound') as lower_bound
     , (lv.details ->> 'upper_bound') as upper_bound
     , is_active
     , is_hidden
     , sequence
  from lookups  lkp
 inner join lookup_values lv
    on lv.lookup_id = lkp.id
 where lkp.name = 'Range';
`

// Procedure definitions
export const importJsonbProcedureDDL = `
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
`

export const importLookupsProcedureDDL = `
set search_path to staging;

create or replace procedure import_lookups()
language plpgsql
as
$$
begin
  insert into config.lookups(
     name
   , is_editable
   , description
   , modified_on
   , modified_by)
  select trim(stg.name)
       , stg.is_editable
       , stg.description
       , coalesce(stg.modified_on, now()) as modified_on
       , coalesce(stg.modified_by, current_user)
    from staging.lookups stg
  where not exists (select 1
                       from config.lookups lkp
                      where lkp.name        = trim(stg.name)
                        and lkp.modified_on > stg.modified_on)
      on conflict(name)
      do update
            set is_editable  = excluded.is_editable
              , description  = excluded.description
              , modified_by  = excluded.modified_by
              , modified_on  = excluded.modified_on;
end;
$$
`

// Complex procedural code
export const complexProcedureDDL = `
set search_path to staging;

create or replace procedure import_lookup_values()
language plpgsql
as
$$
begin
  insert into config.lookups(name, modified_on, modified_by)
  select distinct trim(name)
       , first_value(modified_on)  over (partition by trim(name) order by modified_on)
       , coalesce(first_value(modified_by) over (partition by name order by modified_on), current_user)
    from staging.lookup_values slv
   where not exists (select 1
                       from config.lookups lkp
                      where lkp.name = trim(slv.name));

  insert into config.lookup_values(
     lookup_id
   , value
   , sequence
   , is_active
   , is_hidden
   , details
   , description
   , modified_on
   , modified_by)
  select distinct
         lkp.id
       , trim(slv.value)    as value
       , slv.sequence
       , slv.is_active
       , slv.is_hidden
       , slv.details
       , slv.description
       , slv.modified_on
       , coalesce(slv.modified_by, current_user) as modified_by
    from staging.lookup_values slv
   inner join config.lookups lkp
      on lkp.name = trim(slv.name)
   where not exists
            (select 1
               from config.lookup_values lkv
              where lkv.lookup_id   = lkp.id
                and lkv.value       = trim(slv.value)
                and lkv.modified_on > slv.modified_on)
      on conflict(lookup_id, value)
      do update
     set sequence     = excluded.sequence
       , is_active    = excluded.is_active
       , is_hidden    = excluded.is_hidden
       , details      = excluded.details
       , description  = excluded.description
       , modified_by  = excluded.modified_by
       , modified_on  = excluded.modified_on;

end;
$$
`

// Helper function to extract metadata from parsed SQL objects
export function extractTableInfo(createTableAst) {
	if (!createTableAst) return null

	return {
		tableName: createTableAst.table[0].table,
		schemaName: createTableAst.table[0].schema,
		ifNotExists: createTableAst.if_not_exists || false,
		columns: createTableAst.create_definitions.map((colDef) => ({
			name: colDef.column.column,
			dataType: colDef.definition.dataType,
			nullable: !colDef.nullable?.not,
			defaultValue: colDef.default_val?.value?.value,
			isPrimaryKey: colDef.primary_key,
			references: colDef.reference_definition
				? {
						table: colDef.reference_definition.table[0].table,
						schema: colDef.reference_definition.table[0].schema,
						column: colDef.reference_definition.reference_columns?.[0]?.column
					}
				: null
		}))
	}
}
