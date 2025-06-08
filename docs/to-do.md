# To Do

Need to modify the parser to identify references when there are schemas.

Support the following ddl
```sql
create table if not exists config.features (
        id                       uuid primary key default uuid_generate_v4()
      , title                    varchar
      , modified_at              timestamp with time zone not null default now()
      , modified_by              varchar
      );
comment on column config.features.id IS 'unique id of features';
comment on column features.title IS 'unique id of features';
```

- Should be parsed with table name as config.feature.
- should identify that features.title is invalid as there is no table specified as features or better yet say that schema config is missing.

Might be good if we used an AST to parse the script and identify any parsing errors and at the same time identify schemas, tables and columns.
