# Quickstart: New Project End-to-End

## 1. Install

```sh
# macOS
brew install bun
bun i --global @jerrythomas/dbd

# Ubuntu/Debian
sudo snap install bun
bun i --global @jerrythomas/dbd
```

Requires: PostgreSQL client (`psql`) in PATH.

## 2. Scaffold

```sh
dbd init -p myproject
cd myproject
```

This copies the example project structure. You get:

```
myproject/
  design.yaml              # Project configuration
  ddl/                     # DDL files (auto-discovered)
    table/
      config/
        lookups.ddl
        lookup_values.ddl
    view/
      config/
        genders.ddl
    procedure/
      staging/
        import_lookups.ddl
  import/                  # Staging data files
    staging/
      lookups.csv
      lookup_values.csv
    loader.sql             # Post-import SQL
  export/                  # Created by `dbd export` (not committed)
```

## 3. Set database URL

```sh
export DATABASE_URL=postgres://user:pass@localhost:5432/mydb
```

Or pass with `-d`:
```sh
dbd apply -d postgres://user:pass@localhost:5432/mydb
```

## 4. Validate configuration

```sh
dbd inspect
```

Output:
- `Everything looks ok` — ready to apply
- Lists errors (blocking) and warnings (non-blocking) per entity

To inspect a single entity:
```sh
dbd inspect -n config.lookups
```

## 5. Apply schema

```sh
dbd apply
```

Applies all entities in dependency order:
1. Schemas (`CREATE SCHEMA IF NOT EXISTS`)
2. Extensions (`CREATE EXTENSION IF NOT EXISTS`)
3. Roles
4. Tables, views, functions, procedures (topologically sorted)

Apply only one entity:
```sh
dbd apply -n config.lookups
```

Dry run (print entities without executing):
```sh
dbd apply --dry-run
```

## 6. Load staging data

```sh
dbd import
```

Reads files from `import/<schema>/` and loads them into the database.
After all files are loaded, runs any SQL listed in `import.after`.

Load one table:
```sh
dbd import -n staging.lookup_values
```

## 7. Export data

```sh
dbd export
```

Writes files to `export/<schema>/<name>.csv` (or other format).

## 8. Generate DBML documentation

```sh
dbd dbml
```

Writes `design.dbml` (one file per `dbdocs` key in config).

## 9. Combine all DDL into one file

Useful for seeding a fresh database in CI:
```sh
dbd combine -f init.sql
```

## Adding a new table

1. Create `ddl/table/<schema>/<name>.ddl`
2. Write the DDL (see [03-ddl-patterns.md](./03-ddl-patterns.md))
3. Run `dbd inspect` to validate
4. Run `dbd apply -n <schema>.<name>` to apply just this table

## Adding a new schema

Add the schema name to `design.yaml` under `schemas:`. Do not create a DDL file — dbd generates the `CREATE SCHEMA` statement automatically.

## Adding an extension

Add the extension name to `design.yaml` under `extensions:`. Do not create a DDL file.

## Typical development loop

```sh
# Edit DDL files
dbd inspect             # Validate
dbd apply               # Apply to dev database
dbd combine -f init.sql # Optional: regenerate seed file
dbd dbml                # Optional: regenerate docs
```
