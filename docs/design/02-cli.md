# 02 — CLI & Core Orchestration Design

**Package:** Legacy `src/` (target: `packages/cli/`)  
**Status:** Active — monolithic, pending workspace refactoring

## Architecture

```
CLI Entry (index.js)
  │  sade command parser
  │
  ▼
Design Class (collect.js)
  │  using(file, databaseURL) factory
  │
  ├──→ Configuration Loading
  │      metadata.read(file)     → parse YAML
  │      filler.fillMissing()    → ensure defaults
  │      metadata.clean(data)    → discover files + merge + organize
  │
  ├──→ Entity Management
  │      entity.entityFromFile()     → file path → entity object
  │      entity.validateEntityFile() → validate structure + refs
  │      entity.ddlFromEntity()      → entity → SQL string
  │
  ├──→ Reference Resolution
  │      parser.parseEntityScript()  → extract refs from SQL
  │      parser.matchReferences()    → resolve refs to entities
  │      exclusions.isInternal()     → filter built-in functions
  │
  └──→ Execution
         psql via child_process      → execute SQL against database
```

## Module Map

```
src/
├── index.js          # CLI entry point (sade commands)
├── collect.js        # Design class — main orchestrator
├── metadata.js       # YAML config + file discovery + dependency ordering
├── parser.js         # SQL reference extraction (legacy, NOT packages/parser)
├── entity.js         # Entity creation, validation, DDL/import/export generation
├── constants.js      # Entity type constants, default options
├── exclusions.js     # Built-in function filtering (ANSI, PostgreSQL, extensions)
└── filler.js         # Config normalization (ensure arrays + types exist)
```

**Important:** `src/parser.js` is the legacy reference extractor (regex-based, finds function calls and table references in SQL scripts). It is distinct from `packages/parser/` which is the AST-based DDL parser.

## Design Class (`collect.js`)

Central orchestrator. Constructed via `using(file, databaseURL)` factory.

### Lifecycle

```
using(file, url)
  → constructor
    → metadata.read(file)          # Parse YAML
    → filler.fillMissing(data)     # Normalize
    → metadata.clean(data)         # Discover + merge + organize
    → build entity list            # Schemas + extensions + roles + entities
    → organizeImports()            # Order import tables by dependency
  → validate()                     # Check files, naming, references, cycles
  → command method                 # apply/combine/dbml/import/export/report
```

### Entity Construction Order

The Design class builds its entity list in execution order:

1. **Schemas** — `entityFromSchemaName()` for each `config.schemas[]`
2. **Extensions** — `entityFromExtensionConfig()` for each `config.extensions[]`
3. **Roles** — `entityFromRoleName()` for each `config.roles[]`
4. **DDL entities** — tables, views, functions, procedures from `metadata.clean()`

This order ensures schemas exist before extensions, extensions before tables, etc.

## Configuration Pipeline (`metadata.js`)

### `read(file)` → `clean(data)` → `organize(data)`

```
design.yaml
  │
  ▼ read()
YAML parsed → filler.fillMissing()
  │
  ▼ clean()
Scan ddl/ folder → entityFromFile() per file
  → parseEntityScript() → extract references
  → matchReferences() → resolve to entities
  → merge(scanned, configured) → config overrides scanned
  → organize() → topological sort by dependencies
  │
  ▼
Scan import/ folder → entityFromImportConfig() per file
  → merge with config import tables
  → apply schema-specific options
  │
  ▼
Final config with organized entities + import tables
```

### Dependency Resolution (`metadata.organize()`)

Uses topological grouping:

1. Build adjacency list from `refers` arrays
2. Group entities into layers (no deps → depends on layer 0 → depends on layer 1 → ...)
3. Entities in cycles get `errors: ['cyclic dependency']`
4. Returns `{ groups, errors }` — groups are arrays of arrays

## Reference Extraction (`parser.js`)

### `parseEntityScript(entity)`

1. Read file content
2. Extract entity type/name/schema from `CREATE` statement
3. Extract `search_path` from `SET search_path TO ...`
4. Extract references:
   - `extractReferences()` — function/procedure calls (regex: `schema.name(` or `name(`)
   - `extractTableReferences()` — FROM/JOIN targets
   - `extractTriggerReferences()` — `ON table_name` in triggers
5. Filter out:
   - CTE aliases (`WITH x AS (...)`)
   - SQL expressions mistaken for functions
   - Self-references
6. Return entity with `refers[]`, `searchPaths[]`, `errors[]`

### `matchReferences(entities, extensions)`

1. Build lookup tree of all entity names
2. For each entity's unresolved references:
   - Try qualified name first (`schema.name`)
   - Try each search path (`searchPath.name`)
   - Check `exclusions.isInternal()` — skip built-in functions
3. Unresolved refs become errors on the entity

## Built-in Function Filtering (`exclusions.js`)

Three layers of filtering with caching:

1. **ANSI SQL** — ~100+ standard functions (COUNT, SUM, COALESCE, TRIM, etc.)
2. **PostgreSQL** — internal functions + patterns (`pg_*`, `array_*`, `now`, `unnest`, etc.)
3. **Extensions** — configurable per installed extension:
   - `uuid-ossp` → `uuid_*`
   - `postgis` → `st_*`, `geom_*`
   - `pgcrypto` → `gen_salt`, `crypt`
   - `timescaledb` → `create_hypertable`, `time_bucket`
   - etc.

Cache stores results to avoid redundant regex matching.

## Entity Module (`entity.js`)

### Entity Object Shape

```javascript
{
  type: 'table'|'view'|'function'|'procedure'|'role'|'schema'|'extension'|'import'|'export',
  name: string,           // 'schema.object' or 'object'
  schema: string|null,    // Extracted schema
  file: string|null,      // Path to DDL/data file
  format: string|null,    // 'ddl'|'csv'|'tsv'|'json'|'jsonl'
  refers: string[],       // Names of referenced entities
  errors: string[],       // Validation errors
  // Import-specific:
  nullValue: string,
  truncate: boolean,
  listed: boolean
}
```

### DDL Generation

`ddlFromEntity(entity)` dispatches by type:

- **File-backed** (table, view, function, procedure) → read file content
- **Schema** → `CREATE SCHEMA IF NOT EXISTS {name};`
- **Extension** → `CREATE EXTENSION IF NOT EXISTS "{name}" WITH SCHEMA {schema};`
- **Role** → idempotent `DO $do$ BEGIN ... CREATE ROLE ... END $do$;` + `GRANT` statements

### Import Script Generation

`importScriptForEntity(entity)`:

- CSV/TSV: `\copy {table} FROM '{file}' WITH DELIMITER ... CSV HEADER;`
- JSON/JSONL: Create temp table → `\copy` into temp → call `staging.import_jsonb_to_table()`
- Optional `TRUNCATE TABLE` prefix (with exception fallback to `DELETE`)

### Export Script Generation

`exportScriptForEntity(entity)`:

- CSV/TSV: `\copy (SELECT * FROM {table}) TO '{file}' WITH DELIMITER ... CSV HEADER;`
- JSON/JSONL: `\copy (SELECT row_to_json(t) FROM {table} t) TO '{file}';`

## Execution

All database operations use `psql` via child process:

- Temporary `.sql` files written, executed via `psql -f`, then cleaned up
- `DATABASE_URL` environment variable or explicit connection string
- No programmatic database connection in the CLI layer

## Technical Debt

- **Monolithic `collect.js`** — Design class does too much (validation, execution, DBML, import, export)
- **Two parser modules** — `src/parser.js` (reference extraction) and `packages/parser/` (DDL parsing) overlap in purpose
- **psql dependency** — execution requires `psql` installed; no programmatic DB connection
- **No streaming** — entire DDL loaded into memory for combine/DBML operations
- **Entity validation scattered** — validation logic split across `entity.js`, `metadata.js`, and `collect.js`
