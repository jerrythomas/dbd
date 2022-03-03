set search_path to migrate;

create or replace view lookup_values
as
select lkp.name
     , lkv.value
     , lkv.details
     , lkv.is_active
     , lkv.modified_on
     , lkv.modified_by
  from core.lookups lkp
 inner join core.lookup_values lkv
    on lkp.id = lkv.lookup_id;