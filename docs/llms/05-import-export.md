# Import and Export Data

## Overview

| Direction | Command      | Source/Dest                               | Purpose            |
| --------- | ------------ | ----------------------------------------- | ------------------ |
| Import    | `dbd import` | `import/<schema>/<name>.<ext>` → database | Load staging data  |
| Export    | `dbd export` | database → `export/<schema>/<name>.<ext>` | Extract table data |

## Import

### File layout

Place data files under `import/` using the schema/name path convention:

```
import/
  staging/
    lookup_values.csv
    lookups.tsv
    events.jsonl
```

File path `import/staging/lookup_values.csv` maps to entity `staging.lookup_values`.

### Supported formats

| Format     | Extension | Behaviour                                          |
| ---------- | --------- | -------------------------------------------------- |
| CSV        | `.csv`    | Comma-delimited with header row                    |
| TSV        | `.tsv`    | Tab-delimited with header row                      |
| JSON Lines | `.jsonl`  | One JSON object per line                           |
| JSON array | `.json`   | Same as jsonl — each line loaded via JSONB staging |

For JSON/JSONL: a temporary `_temp (data jsonb)` table is created, data is loaded into it, then `staging.import_jsonb_to_table('_temp', '<table>')` is called (you must provide this procedure).

### design.yaml import configuration

```yaml
import:
  options: # Defaults applied to all tables
    truncate: true # Clear table before loading
    nullValue: '' # CSV value that represents NULL
    format: csv # Default format

  tables: # Optional: explicit list overrides auto-discovery
    - staging.lookups # Use defaults
    - staging.events: # Override per table
        format: jsonl
        truncate: false

  schemas: # Override options per schema
    staging:
      truncate: false

  after: # SQL files run after all imports
    - import/loader.sql
```

**Auto-discovery:** If `tables:` is omitted, dbd discovers all files in `import/` with supported extensions. If `tables:` is present, only listed tables are imported.

**Merge behaviour:** When the same table appears in both auto-discovered files and the `tables:` list, config values from `tables:` override file-discovered values.

### Truncate behaviour

When `truncate: true`:

1. Try `TRUNCATE TABLE <name>` (fast)
2. If that fails (e.g. FK constraint violation), fall back to `DELETE FROM <name>; COMMIT;`

Set `truncate: false` for append-only imports.

### Import restrictions

- Import is only allowed for schemas listed in `project.staging`
- If a table's schema is not in `staging`, validation reports an error and the table is skipped

### Environment-aware imports

Place files in environment subfolders for dev- or prod-specific data:

```
import/
  dev/
    staging/
      fixtures.csv      # loaded only with -e dev
  prod/
    staging/
      seeds.csv         # loaded only with -e prod
  staging/
    lookups.csv         # loaded in all environments (shared)
```

Control which environment loads with `dbd import -e dev` or `dbd import -e prod`.

Declare specific tables with env restrictions in `design.yaml`:

```yaml
import:
  tables:
    - staging.lookup_values:
        env: [dev, prod] # shared (both envs)
    - staging.fixtures:
        env: dev # dev only
```

### Import procedures (automatic)

After each table is imported, dbd automatically calls `staging.import_<tablename>()` if that procedure exists. No configuration needed — it follows the naming convention.

For `staging.lookup_values` → calls `staging.import_lookup_values()` (if it exists).

A warning appears in `dbd inspect` if a staging table has no matching import procedure.

### Post-import SQL (`import.after`)

SQL files listed under `after:` are executed in order after all table imports complete. Use `import.after` for SQL that runs after all imports and does not follow the `staging.import_<name>()` naming convention. Use for:

- Running aggregations or cleanup that spans multiple tables
- Custom post-processing not covered by per-table procedures

```yaml
import:
  after:
    - import/custom-cleanup.sql
```

### Running import

```sh
dbd import                              # Import all tables + run after scripts
dbd import -n staging.lookup_values     # Import one table only (skips after scripts)
dbd import -n import/staging/lookups.csv  # Import by file path
dbd import --dry-run                    # Print what would be imported without executing
```

---

## Export

### design.yaml export configuration

```yaml
export:
  - config.lookups # Export as CSV (default)
  - config.lookup_values: # Override format
      format: jsonl
  - config.events:
      format: tsv
```

### Output file layout

```
export/
  config/
    lookups.csv
    lookup_values.jsonl
    events.tsv
```

The `export/` folder is created automatically. It is typically gitignored.

### Supported formats

| Format     | Extension           | Behaviour                                                            |
| ---------- | ------------------- | -------------------------------------------------------------------- |
| CSV        | `.csv`              | `\copy (SELECT * FROM ...) TO 'file' WITH DELIMITER E',' CSV HEADER` |
| TSV        | `.tsv`              | Same with tab delimiter                                              |
| JSON Lines | `.json` or `.jsonl` | `\copy (SELECT row_to_json(t) FROM ... t) TO 'file'`                 |

### Running export

```sh
dbd export                              # Export all configured tables
dbd export -n config.lookups            # Export one table
```

---

## CSV file format

dbd uses PostgreSQL's `\copy` command. Follow these conventions:

```csv
id,lookup_id,value,sequence,is_active
550e8400-...,a0eebc99-...,Male,1,true
550e8400-...,a0eebc99-...,Female,2,true
```

- First row must be header with column names
- Empty string (`''`) represents NULL (configurable via `nullValue`)
- Boolean: `true` / `false`
- UUID: standard UUID string format
- Timestamps: ISO 8601 (`2024-01-15 10:30:00+00`)

---

## End-to-end staging workflow example

```
# 1. Place data files
import/staging/lookups.csv
import/staging/lookup_values.csv

# 2. Create staging tables (DDL)
ddl/table/staging/lookups.ddl
ddl/table/staging/lookup_values.ddl

# 3. Create production tables (DDL)
ddl/table/config/lookups.ddl
ddl/table/config/lookup_values.ddl

# 4. Create import procedure (DDL)
ddl/procedure/staging/import_lookups.ddl

# 5. Configure design.yaml
import:
  options:
    truncate: true
  tables:
    - staging.lookups
    - staging.lookup_values

# After each CSV loads, `staging.import_lookups()` and `staging.import_lookup_values()` are called automatically.

# 6. Apply schema
dbd apply

# 7. Load staging data
dbd import

# 8. Verify
dbd export -n config.lookups
```
