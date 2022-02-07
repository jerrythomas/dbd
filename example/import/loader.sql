insert into core.lookups(name)
select distinct lookup_name
  from staging.lookup_values slv
 where not exists (select 1
                     from core.lookups lkp
										where lkp.name = slv.lookup_name);

insert into core.lookup_values(lookup_id, value, description, is_active)
select distinct
       lkp.id
		 , slv.value
		 , slv.description
		 , slv.is_active
  from staging.lookup_values slv
 inner join core.lookups lkp
    on lkp.name = slv.lookup_name
 where not exists (select 1
                     from core.lookup_values lkv
										where lkv.lookup_id = lkp.id
										  and lkv.value     = slv.value);