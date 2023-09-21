set search_path to staging;

create or replace procedure import_lookups()
language plpgsql
as
$$
begin
  insert into config.lookups(name, modified_on, modified_by)
  select distinct name
       , first_value(modified_on)  over (partition by name order by modified_on)
       , coalesce(first_value(modified_by) over (partition by name order by modified_on), current_user)
    from staging.lookup_values slv
   where not exists (select 1
                       from config.lookups lkp
                      where lkp.name = slv.name);

  update config.lookup_values lv
     set ( sequence
         , details
         , modified_by
         , modified_on
         ) = (select slv.sequence
                   , slv.details
                   , coalesce(slv.modified_by,current_user)
                   , slv.modified_on
                from staging.lookup_values slv
               inner join config.lookups lkp
                  on lkp.name  = slv.name
               where slv.value = lv.value
                 and lkp.id    = lv.lookup_id )
   where exists
        (select 1
           from staging.lookup_values slv
          inner join config.lookups lkp
             on lkp.name  = slv.name
          where slv.value = lv.value
            and lkp.id    = lv.lookup_id);

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
       , coalesce(slv.modified_by,current_user)
    from staging.lookup_values slv
   inner join config.lookups lkp
      on lkp.name = slv.name
   where not exists
            (select 1
               from config.lookup_values lkv
              where lkv.lookup_id = lkp.id
                and lkv.value     = slv.value);

end;
$$
