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
