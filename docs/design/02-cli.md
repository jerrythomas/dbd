# 02 — CLI & Design Orchestration

**Package:** `packages/cli/` (`dbd`)
**Status:** Active — v2.0.0 workspace package

## Architecture

```
CLI Entry (index.js)
  │  sade command parser
  │
  ▼
Design Class (design.js)
  │  using(file, databaseURL) factory
  │
  ├──→ Configuration Loading
  │      config.read(file)          → parse YAML + fill defaults
  │      config.clean(data, ...)    → discover files + parse refs + merge
  │
  ├──→ Reference Extraction
  │      references.parseEntityScript()  → AST-based (primary) + regex (fallback)
  │      references.matchReferences()    → resolve refs to known entities
  │      references.isInternal()         → filter built-in functions
  │
  ├──→ Entity Processing (from @dbd/db)
  │      entityFromSchemaName()          → schema entities
  │      entityFromExtensionConfig()     → extension entities
  │      entityFromFile()                → file path → entity object
  │      validateEntity()                → validate structure + refs
  │      ddlFromEntity()                 → entity → SQL string
  │      sortByDependencies()            → topological ordering
  │
  ├──→ DB Reference Cache (db-cache.js)
  │      DbReferenceCache                → lazy DB lookup for unresolved refs
  │      resolveWarnings()               → verify warnings against DB catalog
  │
  └──→ Execution (via @dbd/db adapter)
         createAdapter('postgres', url)  → PostgreSQLAdapter
         adapter.applyEntities()         → execute DDL
         adapter.importData()            → load data
         adapter.batchExport()           → export data
```

## Module Map

```
packages/cli/src/
├── index.js          # CLI entry point (sade commands)
├── design.js         # Design class — main orchestrator
├── config.js         # YAML config + file discovery + entity merging
├── references.js     # AST-based + regex reference extraction & exclusions
└── db-cache.js       # Database reference cache for unresolved references
```

## Design Class (`design.js`)

Central orchestrator. Constructed via `using(file, databaseURL)` factory.

### Lifecycle

```
using(file, url)
  → constructor
    → config.read(file)                # Parse YAML + fill defaults
    → config.clean(data, parseEntityScript, matchReferences)
                                       # Discover DDL files + parse refs + merge
    → sortByDependencies(roles)        # Order roles
    → sortByDependencies(entities)     # Order entities
    → build entity list                # Schemas + extensions + roles + entities
    → organizeImports()                # Order import tables by dependency
  → validate()                         # Check files, naming, references
  → command method                     # apply/combine/dbml/import/export/report
```

### Entity Construction Order

The Design class builds its entity list in execution order:

1. **Schemas** — `entityFromSchemaName()` for each `config.schemas[]`
2. **Extensions** — `entityFromExtensionConfig()` for each `config.extensions[]`
3. **Roles** — sorted by dependencies from `config.roles[]`
4. **DDL entities** — tables, views, functions, procedures from `config.clean()`

### Key Methods

| Method                       | Sync/Async | Description                                      |
| ---------------------------- | ---------- | ------------------------------------------------ |
| `validate()`                 | sync       | Validates all entities, roles, and import tables |
| `report(name?)`              | sync       | Returns `{ entity, issues, warnings }`           |
| `apply(name?, dryRun?)`      | async      | Executes DDL via adapter                         |
| `combine(file)`              | sync       | Writes combined DDL to file                      |
| `dbml(file?)`                | sync       | Generates DBML via `@dbd/dbml`                   |
| `importData(name?, dryRun?)` | async      | Loads data via adapter                           |
| `exportData(name?)`          | async      | Exports data via adapter                         |
| `getAdapter()`               | async      | Lazy-creates database adapter                    |
| `updateEntities(entities)`   | sync       | Replaces entities after DB resolution            |

### Adapter Integration

The Design class uses `@dbd/db`'s `createAdapter()` factory for database operations:

```javascript
async getAdapter() {
  const { createAdapter } = await import('@jerrythomas/dbd-db')
  this.#adapter = await createAdapter('postgres', this.databaseURL)
}
```

This replaces the legacy `psql` via `child_process` approach. The adapter is created lazily — only when a database operation is needed.

## Configuration Pipeline (`config.js`)

### `read(file)` → `clean(data, parseEntityScript, matchReferences)`

```
design.yaml
  │
  ▼ read()
YAML parsed → fillMissingInfoForEntities()
  → ensure roles/tables/views/functions/procedures arrays exist
  → add type property to each entity
  │
  ▼ clean()
Scan ddl/ folder → entityFromFile() per file
  → parseEntityScript() → extract references (AST primary, regex fallback)
  → matchReferences() → resolve to known entities
  → merge(scanned, configured) → config overrides scanned
  │
Scan import/ folder → entityFromImportConfig() per file
  → merge with config import tables
  → apply schema-specific options
  │
  ▼
Final config with entities, importTables, schemas, roles
```

### Key Functions

| Function                                          | Description                                                |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `read(file)`                                      | Parses YAML, fills defaults, normalizes entity arrays      |
| `clean(data, parseEntityScript, matchReferences)` | Discovers files, parses refs, merges with config           |
| `cleanDDLEntities(data, ...)`                     | Scans `ddl/` folder, creates entities, resolves references |
| `fillMissingInfoForEntities(data)`                | Ensures all entity type arrays exist with defaults         |
| `scan(root)`                                      | Recursive directory listing                                |
| `merge(x, y)`                                     | Merges two entity arrays by name (y overrides x)           |

## Reference Extraction (`references.js`)

### Dual-Path Strategy

**Primary:** AST-based extraction via `@dbd/parser`'s `extractDependencies()`. Analyzes SQL via proper AST parsing, naturally excluding comments and string content.

**Fallback:** Regex-based extraction (legacy). Used when AST parsing fails for unsupported SQL syntax.

### `parseEntityScript(entity)`

1. Read file content
2. Try AST path: `extractDependencies(content)` from `@dbd/parser`
   - Returns structured `{ entity, searchPaths, references }`
   - Self-references filtered out
   - Schema/type validation against file path
3. On AST failure, fall back to regex path:
   - `extractSearchPaths()` — `SET search_path TO ...`
   - `extractReferences()` — function/procedure calls
   - `extractTableReferences()` — FROM/JOIN targets
   - `extractTriggerReferences()` — `ON table_name` in triggers
   - Filter CTE aliases, SQL expressions, self-references

### `matchReferences(entities, extensions)`

1. Build lookup tree of all entity names
2. For each entity's unresolved references:
   - Try qualified name first (`schema.name`)
   - Try each search path (`searchPath.name`)
   - Check `isInternal()` — skip built-in functions
   - Check `matchesKnownExtension()` — warn if extension may be undeclared
3. Unresolved refs become warnings (not errors) on the entity
4. Populates `entity.refers[]` with resolved dependency names

### Built-in Function Filtering

Three layers with caching:

1. **ANSI SQL** — ~100+ standard functions (COUNT, SUM, COALESCE, TRIM, etc.)
2. **PostgreSQL** — internal functions + patterns (`pg_*`, `array_*`, `now`, `unnest`, etc.)
3. **Extensions** — configurable per installed extension (uuid-ossp, postgis, pgcrypto, timescaledb, etc.)

## DB Reference Cache (`db-cache.js`)

When `dbd inspect` finds unresolved references (warnings), it can optionally query the database to verify whether they actually exist.

### `DbReferenceCache`

- Lazy-loaded: only queries DB when a reference is not in cache
- Persists to `~/.config/dbd/cache/<hash>.json` keyed by connection URL
- Used by `inspect` command when `--database` is provided
- Skipped with `--no-cache` flag

### `resolveWarnings(entities, dbResolver)`

For each entity with warnings, re-resolves references against the DB catalog. If found in the DB, the warning is removed and the reference is added to `refers[]`.

## CLI Entry Point (`index.js`)

Uses `sade` for command parsing. Seven commands:

| Command   | Action                                          | Sync/Async |
| --------- | ----------------------------------------------- | ---------- |
| `init`    | Clone example template via `degit`              | sync       |
| `inspect` | Validate + report (with optional DB resolution) | async      |
| `apply`   | Execute DDL against database                    | async      |
| `combine` | Merge DDL into single file                      | sync       |
| `import`  | Load data files into database                   | async      |
| `export`  | Extract data from database                      | async      |
| `dbml`    | Generate DBML documentation                     | sync       |

Global options: `--config`, `--database`, `--environment`, `--preview`.
