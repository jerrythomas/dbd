set search_path to staging;

create or replace procedure import_lookups()
language plpgsql
as
$$
begin
  insert into config.lookups(name, modified_on, modified_by)
  select distinct name
       , first_value(modified_on)  over (partition by name order by modified_on)
       , (first_value(modified_by) over (partition by name order by modified_on))::uuid
    from staging.lookup_values slv
   where not exists (select 1
                       from config.lookups lkp
                      where lkp.name = slv.name);

  update config.lookup_values lv
     set ( sequence
         , details) = (select slv.sequence
                           , slv.details
                        from staging.lookup_values slv
                       inner join config.lookups lkp
                          on lkp.name  = slv.name
                       where slv.value = lv.value
                         and lkp.id    = lv.lookup_id )
   where exists (select 1
                   from staging.lookup_values slv
                  inner join config.lookups lkp
                     on lkp.name = slv.name
                  where slv.value = lv.value
                    and lkp.id = lv.lookup_id);

  insert into config.lookup_values(
     lookup_id
   , value
   , sequence
   , exclude
   , details
   , is_active
   , modified_on
   , modified_by)
  select distinct
         lkp.id
       , slv.value
       , slv.sequence
       , slv.exclude
       , slv.details
       , slv.is_active
       , slv.modified_on
       , slv.modified_by::uuid
    from staging.lookup_values slv
   inner join config.lookups lkp
      on lkp.name = slv.name
   where not exists (select 1
                       from config.lookup_values lkv
                      where lkv.lookup_id = lkp.id
                        and lkv.value     = slv.value);

end;
$$
