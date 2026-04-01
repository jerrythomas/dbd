create or replace view migrate.items as
select name from staging.items;
