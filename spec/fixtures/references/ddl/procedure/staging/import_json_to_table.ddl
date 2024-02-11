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
