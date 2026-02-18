# 04 — v2.0.0 Architecture

## Overview

Monorepo with clear package boundaries. Each package has a single responsibility, communicates through well-defined interfaces, and can be tested independently. Migration from the legacy monolithic `src/` is complete — all code lives in workspace packages.

```
┌──────────────────────────────────────────────────────────────┐
│                        packages/cli                          │
│  CLI commands, configuration loading, orchestration          │
│  Entry point: `dbd` binary                                   │
└──────┬───────────┬───────────────────┬───────────────────────┘
       │           │                   │
       ▼           ▼                   ▼
┌────────────┐ ┌────────────┐ ┌──────────────────────────────┐
│  packages/ │ │  packages/ │ │         packages/db           │
│   parser   │ │    dbml    │ │  Adapter interface, entity    │
│            │ │            │ │  processing, dependency       │
│ SQL → AST  │ │ DDL → DBML │ │  resolution                  │
│ → metadata │ │            │ │                               │
└────────────┘ └────────────┘ └──────────────┬────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │      adapters/postgres        │
                              │  PostgreSQL-specific:         │
                              │  connection, COPY, DDL exec   │
                              └──────────────────────────────┘
```

### Dependency Rules

```
cli  →  parser (SQL analysis, reference extraction)
cli  →  db     (adapter factory, entity processing, dependency resolution)
cli  →  dbml   (DBML generation)
dbml →  parser (DDL parsing for schema extraction)
db   →  (no package deps — defines interfaces only)
adapters/postgres → db (implements BaseDatabaseAdapter)
```

**No circular dependencies.** `db` is the interface layer — it never imports from adapters. Adapters are loaded dynamically at runtime.

---

## Package Specifications

### packages/parser (`@dbd/parser`)

**Status:** Complete. 114 tests passing.

**Responsibility:** Parse SQL DDL → extract structured metadata.

**Public API:**

```javascript
// Functional API (preferred)
export function extractSchema(sql, options)      // → { tables, views, procedures, indexes }
export function extractTableDefinitions(sql)     // → Table[]
export function extractViewDefinitions(sql)      // → View[]
export function extractProcedureDefinitions(sql) // → Procedure[]
export function extractIndexDefinitions(sql)     // → Index[]
export function validateDDL(sql)                 // → { valid, message, errors? }

// Class API (legacy compat)
export class SQLParser { ... }
```

**No changes planned** for v2.0.0 beyond what's already on develop.

---

### packages/db (`@dbd/db`)

**Responsibility:** Database-agnostic abstractions. Defines the adapter contract, provides entity processing and dependency resolution. **No database-specific code lives here.**

#### Module: `base-adapter.js` — Adapter Interface

```javascript
export class BaseDatabaseAdapter {
  constructor(connectionString, options = {})

  // Connection lifecycle
  async connect()                              // → void
  async disconnect()                           // → void
  async testConnection()                       // → boolean

  // Core operations
  async executeScript(script, options)         // → result
  async applyEntity(entity, options)           // → void
  async applyEntities(entities, options)       // → void (sequential, in order)

  // Data operations
  async importData(entity, options)            // → void
  async exportData(entity, options)            // → void
  async batchImport(entities, options)         // → void
  async batchExport(entities, options)         // → void

  // Inspection
  async inspect()                              // → { connected, version, capabilities }

  // Utility
  log(message, level)                          // → void (if options.verbose)
}
```

**Design notes:**

- `options` always supports `{ dryRun, verbose }`
- `applyEntity` delegates to `generateEntityScript()` + `executeScript()` — subclasses override both
- `applyEntities` iterates in the order given (caller is responsible for dependency sorting)
- No `console.log` in library code — only via `log()` when verbose is on

#### Module: `entity-processor.js` — Entity Script Generation

Pure functions. No DB dependency, no I/O except file reads.

```javascript
// DDL generation
export function ddlFromEntity(entity)              // → string (SQL)
export function generateRoleScript(entity)         // → string (idempotent role creation)
export function combineEntityScripts(entities, options) // → string (combined DDL)

// Import/export script generation
export function importScriptForEntity(entity)      // → string (COPY/psql commands)
export function exportScriptForEntity(entity)      // → string (COPY TO commands)

// DBML preparation
export function filterEntitiesForDBML(entities, config) // → Entity[]
export function cleanupDDLForDBML(ddl)             // → string (index/proc stripped)

// Validation
export function validateEntity(entity)             // → string[] (errors)
export function getValidEntities(entities)         // → Entity[]

// Organization
export function organizeEntities(entities)         // → { schemas, extensions, roles, tables, ... }
```

**Entity object shape** (unchanged from v1):

```javascript
{
  type: 'table' | 'view' | 'function' | 'procedure' | 'role' | 'schema' | 'extension',
  name: string,            // 'schema.object' or bare 'object'
  schema: string | null,
  file: string | null,     // path to DDL file
  format: string | null,   // 'ddl' | 'csv' | 'tsv' | 'json' | 'jsonl'
  refers: string[],        // names of referenced entities
  errors: string[],        // validation errors
  searchPaths: string[],   // from SET search_path
  // Import-specific:
  truncate: boolean,
  nullValue: string,
  listed: boolean
}
```

#### Module: `dependency-resolver.js` — Topological Sorting

Pure functions. Extracted from current `metadata.organize()` / `metadata.regroup()`.

```javascript
export function buildDependencyGraph(entities)     // → Map<key, Set<dependents>>
export function topologicalSort(graph)             // → string[] (ordered keys)
export function findCycles(graph)                  // → string[][] (cycle paths)
export function validateDependencies(entities)     // → { isValid, cycles, warnings }
export function sortByDependencies(entities)       // → Entity[] (sorted)
export function groupByDependencyLevel(entities)   // → Entity[][] (layered groups)
```

#### Module: `index.js` — Adapter Factory

```javascript
export { BaseDatabaseAdapter } from './base-adapter.js'
export { createAdapter, getAdapterInfo, SUPPORTED_DATABASES } from './factory.js'
// re-export entity-processor and dependency-resolver
```

```javascript
// factory.js
const ADAPTERS = {
  postgres: () => import('@dbd/db-postgres'),
  postgresql: () => import('@dbd/db-postgres')
}

export async function createAdapter(type, connectionString, options) {
  const loader = ADAPTERS[type.toLowerCase()]
  if (!loader) throw new Error(`Unsupported database: ${type}`)
  const mod = await loader()
  return mod.createAdapter(connectionString, options)
}
```

---

### adapters/postgres (`@dbd/db-postgres`)

**Responsibility:** PostgreSQL-specific implementation of `BaseDatabaseAdapter`.

#### Module: `adapter.js` — PostgreSQLAdapter

```javascript
import { BaseDatabaseAdapter } from '@dbd/db'

export class PostgreSQLAdapter extends BaseDatabaseAdapter {
  // Connection: uses chosen DB library (see below)
  async connect()
  async disconnect()

  // Script execution: programmatic, no psql shelling
  async executeScript(script, options)

  // Import: streaming COPY for CSV/TSV, temp table for JSON
  async importData(entity, options)

  // Export: COPY TO
  async exportData(entity, options)

  // Inspection
  async inspect()  // → version, database, user, capabilities
}

export function createAdapter(connectionString, options) {
  return new PostgreSQLAdapter(connectionString, options)
}
```

#### Module: `connection.js` — Connection Management

```javascript
export class PostgreSQLConnection {
  constructor(connectionString)
  async connect()                       // → pool/client
  async query(sql, params)              // → rows
  async transaction(fn)                 // → result (auto commit/rollback)
  async copyFrom(table, stream, opts)   // → void (COPY FROM STDIN)
  async copyTo(table, stream, opts)     // → void (COPY TO STDOUT)
  async close()                         // → void
}
```

#### Module: `scripts.js` — PostgreSQL Script Generators

Pure functions (same as current `src/entity.js` script generation, but PostgreSQL-specific).

```javascript
export function ddlFromEntity(entity)           // → string
export function importScriptForEntity(entity)   // → string
export function exportScriptForEntity(entity)   // → string
export function getRoleScript(entity)           // → string
```

#### DB Library Decision

Three candidates. Decision deferred to Batch 3 implementation:

| Library                  | COPY Support             | Streaming | Bun Compat   | Notes                            |
| ------------------------ | ------------------------ | --------- | ------------ | -------------------------------- |
| `pg` + `pg-copy-streams` | COPY FROM/TO via streams | Yes       | Yes          | Most popular, battle-tested      |
| `postgres.js` (porsager) | Built-in `sql.copy()`    | Yes       | Yes (native) | Fastest, modern API              |
| `@databases/pg`          | Via underlying pg        | Indirect  | Yes          | Used in feature branch, safe SQL |

**Recommendation:** `pg` + `pg-copy-streams` for proven COPY performance, or `postgres.js` for modern API. Either way, `connection.js` abstracts this — the adapter doesn't care which library is underneath.

---

### packages/dbml (`@dbd/dbml`)

**Responsibility:** Generate DBML from DDL entities.

```javascript
export function generateDBML(entities, config)     // → string (DBML content)
export function generateMultipleDBML(entities, dbdocsConfig) // → Map<name, string>
```

Internally:

1. Filter entities via `filterEntitiesForDBML()` (from `@dbd/db`)
2. Get DDL via `ddlFromEntity()` (from `@dbd/db`)
3. Strip indexes, procedures, complex constraints
4. Run through `@dbml/core` importer
5. Replace bare table names with schema-qualified names

Small package. May stay as part of `packages/db` or `packages/cli` if not worth a separate package — your call.

---

### packages/cli (`dbd`)

**Status:** Complete. 55 tests passing + e2e suite.

**Responsibility:** CLI interface, configuration loading, orchestration.

**Binary:** `dbd`

```json
{
  "bin": { "dbd": "src/index.js" }
}
```

#### Module: `index.js` — Command Definitions

```javascript
import sade from 'sade'
// Same 7 commands: init, inspect, apply, combine, import, export, dbml
// Same global options: --config, --database, --environment, --preview
```

#### Module: `design.js` — Orchestrator (replaces `src/collect.js`)

```javascript
export function using(file, databaseURL) {
  return new Design(file, databaseURL)
}

class Design {
  constructor(file, databaseURL)

  // Lifecycle
  validate()                   // → this (chainable)
  report(name?)                // → { entity, issues, warnings }
  updateEntities(entities)     // → replaces entities after DB resolution

  // Operations
  async apply(name?, dryRun?)  // uses adapter.applyEntities()
  combine(file)                // uses ddlFromEntity() + fs.writeFileSync()
  async importData(name?, dryRun?) // uses adapter.importData() per table
  async exportData(name?)      // uses adapter.batchExport()
  dbml(file?)                  // uses @dbd/dbml generateDBML()
  async getAdapter()           // lazy-creates adapter via createAdapter()
}
```

`Design` uses `createAdapter()` from `@dbd/db` instead of shelling out to `psql`. The adapter handles connection, execution, and data transfer.

#### Module: `config.js` — Configuration Loading

Extracted from current `src/metadata.js` + `src/filler.js`:

```javascript
export function readConfig(file)                 // → parsed YAML config
export function discoverEntities(root)           // → Entity[] from file system scan
export function mergeEntities(scanned, config)   // → Entity[] (config overrides scanned)
export function normalizeConfig(data)            // → config with defaults filled
```

#### Module: `references.js` — Reference Extraction

AST-based extraction (primary) via `@dbd/parser` + regex fallback:

```javascript
export function parseEntityScript(entity)        // → entity with refs, searchPaths, errors
export function matchReferences(entities, exts)  // → entities with resolved refs + warnings
export async function resolveWarnings(entities, dbResolver) // → entities with DB-verified refs
export function isInternal(name, extensions)     // → 'internal' | 'extension' | null
// Regex fallback (deprecated, used when AST fails):
export function extractReferences(sql)           // → [{ name, type }]
export function extractTableReferences(sql)      // → [{ name, type }]
```

#### Module: `db-cache.js` — Database Reference Cache

```javascript
export class DbReferenceCache {
  constructor(adapter, connectionUrl)
  load()                                         // → load from ~/.config/dbd/cache/
  save()                                         // → persist to disk
  async resolve(name, searchPaths)               // → {name, schema, type} | null
}
```

---

## Design Patterns

### 1. Adapter Pattern (Database)

```
CLI → createAdapter('postgres', url) → PostgreSQLAdapter
                                        extends BaseDatabaseAdapter
```

- `BaseDatabaseAdapter` defines the contract (abstract methods throw)
- `PostgreSQLAdapter` implements PostgreSQL-specific behavior
- `createAdapter()` factory uses dynamic import — no static dependency on adapters
- Adding a new database = new adapter package, register in factory

### 2. Entity Pipeline

Entities flow through a consistent pipeline regardless of operation:

```
Config (YAML)
  → discoverEntities()       scan file system
  → parseEntityScript()      extract references from SQL
  → matchReferences()        resolve to known entities
  → mergeEntities()          config overrides scanned
  → sortByDependencies()     topological order
  → validateEntity()         check naming, files, refs
  → [operation]              apply / combine / import / export / dbml
```

Every stage is a pure function (except file I/O in discovery). Entities accumulate `errors[]` through the pipeline — they're never thrown. Operations filter to valid entities and report invalid ones.

### 3. Structured Error Collection

```javascript
// Errors accumulate on entities, never thrown
entity.errors = ['File not found: ddl/table/config/missing.ddl']

// Operations check before proceeding
const valid = getValidEntities(entities)
const invalid = getInvalidEntities(entities)

// Report shows both
report(name) → { entity, issues: [...valid with warnings, ...invalid with errors] }
```

### 4. Dry Run / Verbose

Every operation accepts `{ dryRun, verbose }`:

- `dryRun: true` — print what would happen, execute nothing
- `verbose: true` — log progress via `adapter.log()`
- Both propagate from CLI options down to adapter methods

### 5. Script Generation as Pure Functions

All SQL generation (`ddlFromEntity`, `importScriptForEntity`, etc.) are pure functions:

- Input: entity object
- Output: SQL string
- No database connection needed
- Testable without any infrastructure

The adapter calls these functions, then executes the result. This separates "what SQL" from "how to run it."

---

## File Structure

```
dbd/
├── CLAUDE.md
├── agents/
├── docs/
│   ├── requirements/
│   └── design/
├── packages/
│   ├── parser/                    # @dbd/parser — SQL parsing & schema extraction
│   │   ├── src/
│   │   ├── spec/                  # 114 tests
│   │   └── package.json
│   │
│   ├── db/                        # @dbd/db — adapter interface, entity processing
│   │   ├── src/
│   │   │   ├── index.js           # re-exports
│   │   │   ├── factory.js         # createAdapter()
│   │   │   ├── base-adapter.js    # BaseDatabaseAdapter
│   │   │   ├── entity-processor.js
│   │   │   └── dependency-resolver.js
│   │   ├── spec/                  # 99 tests
│   │   └── package.json
│   │
│   ├── dbml/                      # @dbd/dbml — DBML generation
│   │   ├── src/
│   │   │   └── converter.js       # generateDBML()
│   │   ├── spec/                  # 35 tests
│   │   └── package.json
│   │
│   └── cli/                       # dbd — CLI + orchestration
│       ├── src/
│       │   ├── index.js           # sade commands
│       │   ├── design.js          # Design orchestrator
│       │   ├── config.js          # YAML config + file discovery
│       │   ├── references.js      # AST-based + regex reference extraction
│       │   └── db-cache.js        # DB reference cache
│       ├── spec/                  # 55 tests
│       ├── e2e/                   # E2E tests (requires PostgreSQL)
│       └── package.json
│
├── adapters/
│   └── postgres/                  # @dbd/db-postgres — PostgreSQL adapter
│       ├── src/
│       │   ├── index.js           # re-exports
│       │   ├── adapter.js         # PostgreSQLAdapter
│       │   ├── connection.js      # PostgreSQLConnection
│       │   └── scripts.js         # PG-specific script generators
│       ├── spec/                  # 29 tests
│       └── package.json
│
├── spec/
│   └── fixtures/                  # Test fixtures shared across packages
├── example/                       # Example project structure
├── eslint.config.js               # ESLint v9 flat config
└── package.json                   # Root workspace config (private)
```

---

## Root Package

Root `package.json` is workspace-only (`"private": true`). Used for:

- Workspace management (`"workspaces": ["packages/*", "adapters/*"]`)
- Cross-workspace test scripts (`test:unit`, `test:e2e`, etc.)
- Lint/format across all packages
- Binary entry point (`"bin": { "dbd": "packages/cli/src/index.js" }`)

---

## What Changed from v1

| Aspect            | v1.3.2                       | v2.0.0                                         |
| ----------------- | ---------------------------- | ---------------------------------------------- |
| CLI commands      | Same                         | Same (no breaking CLI changes)                 |
| Config format     | `design.yaml`                | Same (no breaking config changes)              |
| Project structure | `ddl/`, `import/`            | Same                                           |
| `psql` dependency | Required                     | Not required (programmatic via adapter)        |
| Code structure    | Monolithic `src/` (8 files)  | Workspace packages + adapters                  |
| Reference parsing | Regex-only                   | AST-based (primary) + regex (fallback)         |
| DB resolution     | None                         | Optional DB catalog lookup for unresolved refs |
| Root package      | Published with CLI + library | Workspace-only, not published                  |

---

## Roadmap

Three objectives planned for the next phase of development:

### Prerequisite: Parser Switch

Replace `node-sql-parser` with `pgsql-parser` (real PostgreSQL parser via WASM). Eliminates regex fallback paths, adds trigger support, enables SQL round-tripping.

See `docs/design/08-parser-switch.md`.

### Objective 1: Entity Classes

Replace plain entity objects with typed classes (`TableEntity`, `ViewEntity`, etc.) that hold structured parse results — columns, constraints, indexes, FK relationships. Enables parse-once-use-everywhere, direct DBML generation, and schema diffing.

See `docs/design/06-entity-classes.md`.

### Objective 2: Snapshots

`dbd snapshot` command to serialize the full schema state as versioned JSON (`snapshots/{version}.json`). Provides a persistence format for entity classes and the baseline for migration generation.

### Objective 3: Migrations

`dbd migrate` command to diff two snapshots, generate ordered ALTER/CREATE/DROP SQL, and apply pending migrations with transaction safety and version tracking (`_dbd_migrations` table).

See `docs/design/07-snapshots-migrations.md` for Objectives 2 and 3.
