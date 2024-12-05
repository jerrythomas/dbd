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
