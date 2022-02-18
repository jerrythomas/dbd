insert into core.lookups(name)
select distinct name
  from staging.lookup_values slv
 where not exists (select 1
                     from core.lookups lkp
										where lkp.name = slv.name);

insert into core.lookup_values(lookup_id, value, details, is_active, modified_on, modified_by)
select distinct
       lkp.id
		 , slv.value
		 , slv.details
		 , slv.is_active
		 , slv.modified_on
		 , slv.modified_by
  from staging.lookup_values slv
 inner join core.lookups lkp
    on lkp.name = slv.name
 where not exists (select 1
                     from core.lookup_values lkv
										where lkv.lookup_id = lkp.id
										  and lkv.value     = slv.value);