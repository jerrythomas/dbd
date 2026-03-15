# design.yaml — Configuration Reference

The `design.yaml` file lives at the project root. It is the single source of truth for project metadata.
DDL entities (tables, views, etc.) are auto-discovered from the `ddl/` folder — you do not list them here.

## Annotated example

```yaml
project:
  name: MyProject           # Display name (used in DBML)
  database: PostgreSQL      # Adapter to use (currently only PostgreSQL supported)
  extensionSchema: extensions  # Schema where extensions are installed
  staging:
    - staging               # Schemas allowed for `dbd import`; import fails for any other schema

schemas:                    # Schemas to CREATE (order does not matter; schemas are created first)
  - config
  - extensions
  - staging
  - migrate

extensions:                 # PostgreSQL extensions to install
  - uuid-ossp              # Simple string = installed into extensionSchema
  - name: postgis           # Object form = installed into a specific schema
    schema: extensions

roles:                      # Database roles to create
  - name: advanced
    refers:                 # `advanced` will be GRANTed `basic` (dependency ordering)
      - basic
  - name: basic

import:
  options:                  # Default options for all import tables
    truncate: true          # Truncate table before loading (default: true)
    nullValue: ''           # String that represents NULL in CSV/TSV (default: '')
    format: csv             # Default file format: csv | tsv | json | jsonl
  tables:                   # Explicit list of tables to import (optional)
    - staging.lookup_values # Simple string: uses default options
    - staging.lookups:      # Object form: override options per-table
        truncate: false
        format: tsv
  schemas:                  # Per-schema option overrides (applied after table options)
    staging:
      truncate: false
  after:                    # SQL files to execute after all imports complete
    - import/loader.sql

export:                     # Tables to export
  - config.lookups          # Simple string: exports as CSV
  - config.lookup_values:   # Object form: override options
      format: jsonl

# DBML generation (optional — only needed if using `dbd dbml`)
# Each key becomes a separate .dbml output file.
# `base` → design.dbml, `core` → design-core.dbml
project:
  dbdocs:
    base:                   # Key name = file suffix (base → design.dbml)
      exclude:
        schemas:
          - staging
          - migrate
          - extensions
    core:
      include:
        schemas:
          - config
      exclude:
        tables:
          - config.audit_log
```

## Field reference

### `project`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Project display name |
| `database` | string | yes | Database type. Only `PostgreSQL` supported |
| `extensionSchema` | string | no | Schema for extensions. Default: `public` |
| `staging` | string[] | no | Schemas allowed for import. Default: `[]` |
| `dbdocs` | object | no | DBML generation config. See below |

### `schemas`

List of schema names. dbd runs `CREATE SCHEMA IF NOT EXISTS <name>` for each.
Schemas from entity file paths are also auto-added — you only need to list schemas that have no entities (e.g. `extensions`, `migrate`).

### `extensions`

List of PostgreSQL extension names (strings or `{name: schema:}` objects).
dbd runs `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA <extensionSchema>`.

### `roles`

List of role objects:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Role name |
| `refers` | string[] | Roles that this role is GRANTed |

Roles are sorted by dependency so grants always succeed.

### `import`

| Field | Type | Description |
|-------|------|-------------|
| `options` | object | Default import options (see below) |
| `tables` | array | Explicit table list (string or `{name: options}`) |
| `schemas` | object | Per-schema option overrides |
| `after` | string[] | SQL files to run after all imports |

**Import options:**

| Field | Default | Description |
|-------|---------|-------------|
| `format` | `csv` | File format: `csv`, `tsv`, `json`, `jsonl` |
| `truncate` | `true` | Truncate table before loading |
| `nullValue` | `''` | String representing NULL in CSV/TSV |

### `export`

List of table names to export (strings or `{name: options}` objects).
Writes to `export/<schema>/<name>.<format>`.

**Export options:**

| Field | Default | Description |
|-------|---------|-------------|
| `format` | `csv` | File format: `csv`, `tsv`, `json`, `jsonl` |

### `project.dbdocs`

Each key is a DBML document name. The key `base` produces `design.dbml`; any other key `foo` produces `design-foo.dbml`.

Each document can have:
```yaml
include:
  schemas: [list]    # Only include these schemas
  tables: [list]     # Only include these tables (schema.name)
exclude:
  schemas: [list]    # Exclude these schemas
  tables: [list]     # Exclude specific tables
```

`include` and `exclude` filters only apply to `table` entities. Views, functions, and procedures are excluded from DBML output.

## What you do NOT put in design.yaml

- Individual tables, views, functions, procedures — these are auto-discovered from `ddl/`
- Column definitions, indexes, constraints — these live in DDL files
- Migration scripts — not yet supported (planned)
