# 05 — v2.0.0 Migration Stages (ARCHIVED)

> **Status: COMPLETE.** All stages executed. Legacy `src/` and `spec/` removed. All code lives in workspace packages. 332 workspace tests passing, 0 lint errors. This document is retained for historical reference.

Detailed stage-by-stage plan for migrating from v1.3.2 monolith to v2.0.0 monorepo. Each stage is an independently committable, test-passing state.

---

## Stage 0: Compatibility Test Suite

**Goal:** Build a safety net that captures every current behavior. No refactoring starts until this is green.

### Why first?

The existing tests in `spec/` are good but they test internal functions. We need tests that verify **user-facing behavior** — the same behavior that must survive the refactoring. If a batch breaks something, these tests catch it immediately.

### What to test

#### 0.1 — Design class integration tests (`spec/compat/design.spec.js`)

Test the `using()` → `validate()` → operation round-trip against `example/`:

```javascript
import { using } from '../src/collect.js'

describe('Design class compatibility', () => {
  const design = using('example/design.yaml')

  it('loads config and discovers entities from example/')
  it('validate() finds no errors in example project')
  it('report() returns structured issues')
  it('report(name) filters to specific entity')
  it('combine() produces valid combined DDL')
  it('combine() output contains all schemas, extensions, tables, views, procedures')
  it('combine() output is in dependency order')
  it('dbml() produces valid DBML for each dbdocs entry')
  it('dbml() respects include/exclude schema filtering')
  it('importData(null, true) dry-run produces import scripts')
  it('exportData() produces export scripts')
})
```

#### 0.2 — Reference extraction snapshots (`spec/compat/references.spec.js`)

Snapshot the legacy `src/parser.js` behavior with known SQL inputs:

```javascript
describe('Reference extraction compatibility', () => {
  it('extractReferences() finds function calls in procedure SQL')
  it('extractReferences() excludes CTE aliases')
  it('extractReferences() excludes SQL expressions')
  it('extractTableReferences() finds FROM/JOIN targets')
  it('extractTriggerReferences() finds ON table_name')
  it('matchReferences() resolves refs across search paths')
  it('matchReferences() filters internal functions')
  it('matchReferences() filters extension functions')
  it('parseEntityScript() extracts entity info from each type')
})
```

#### 0.3 — Entity transformation snapshots (`spec/compat/entity.spec.js`)

Snapshot `src/entity.js` with known inputs:

```javascript
describe('Entity transformation compatibility', () => {
  it('entityFromFile() for table/schema/name.ddl')
  it('entityFromFile() for view/schema/name.ddl')
  it('entityFromFile() for procedure/schema/name.ddl')
  it('entityFromFile() for role/name.ddl')
  it('ddlFromEntity() for schema type')
  it('ddlFromEntity() for extension type')
  it('ddlFromEntity() for role type with grants')
  it('ddlFromEntity() for file-backed entity')
  it('importScriptForEntity() for CSV with truncate')
  it('importScriptForEntity() for JSON format')
  it('exportScriptForEntity() for CSV')
  it('exportScriptForEntity() for JSON')
  it('validateEntityFile() accepts valid entities')
  it('validateEntityFile() rejects missing files')
  it('validateEntityFile() rejects wrong extensions')
})
```

#### 0.4 — Configuration loading snapshots (`spec/compat/config.spec.js`)

```javascript
describe('Configuration loading compatibility', () => {
  it('read() parses example/design.yaml correctly')
  it('clean() discovers DDL files from example/ddl/')
  it('clean() discovers import files from example/import/')
  it('clean() merges scanned + config entities')
  it('organize() sorts entities by dependencies')
  it('organize() detects cyclic dependencies')
})
```

#### 0.5 — Baseline

- All existing `spec/*.spec.js` pass
- All new `spec/compat/*.spec.js` pass
- Record coverage numbers

### Deliverable

New `spec/compat/` directory with ~50 tests that lock in current behavior. These tests import from `src/` directly — they will be updated to import from packages as code moves.

---

## Stage 1: Monorepo Infrastructure

**Goal:** Set up workspace config. No code moves. Everything still works through `src/`.

### Steps

1. **Root `package.json`** — add/verify `"workspaces": ["packages/*", "adapters/*"]`

2. **`packages/db/package.json`**

   ```json
   {
     "name": "@dbd/db",
     "version": "2.0.0-alpha.0",
     "type": "module",
     "main": "src/index.js",
     "dependencies": {},
     "devDependencies": { "vitest": "..." }
   }
   ```

   No external dependencies — this is pure abstractions.

3. **`packages/dbml/package.json`**

   ```json
   {
     "name": "@dbd/dbml",
     "version": "2.0.0-alpha.0",
     "type": "module",
     "main": "src/index.js",
     "dependencies": {
       "@dbd/db": "workspace:*",
       "@dbml/core": "^3.13.5"
     }
   }
   ```

4. **`packages/cli/package.json`**

   ```json
   {
     "name": "@dbd/cli",
     "version": "2.0.0-alpha.0",
     "type": "module",
     "main": "src/index.js",
     "bin": { "dbd-cli": "src/index.js" },
     "dependencies": {
       "@dbd/parser": "workspace:*",
       "@dbd/db": "workspace:*",
       "@dbd/dbml": "workspace:*",
       "sade": "^1.8.1",
       "js-yaml": "^4.1.0",
       "ramda": "^0.30.1"
     }
   }
   ```

   Note: binary is `dbd-cli` during migration. Renamed to `dbd` at Stage 5 switchover.

5. **`adapters/postgres/package.json`**

   ```json
   {
     "name": "@dbd/db-postgres",
     "version": "2.0.0-alpha.0",
     "type": "module",
     "main": "src/index.js",
     "dependencies": {
       "@dbd/db": "workspace:*",
       "<chosen-pg-lib>": "..."
     }
   }
   ```

6. **Update `packages/parser/package.json`** — ensure `"name": "@dbd/parser"` and workspace-compatible versioning.

7. **Workspace test scripts** in root `package.json`:

   ```json
   {
     "scripts": {
       "test:parser": "npm test --workspace=packages/parser",
       "test:db": "npm test --workspace=packages/db",
       "test:dbml": "npm test --workspace=packages/dbml",
       "test:cli": "npm test --workspace=packages/cli",
       "test:postgres": "npm test --workspace=adapters/postgres",
       "test:workspaces": "npm test --workspaces",
       "test:unit": "vitest",
       "test:compat": "vitest run spec/compat/"
     }
   }
   ```

8. **Verify:** `bun install` resolves all workspaces, existing tests pass.

### Deliverable

Package.json files for all packages. `bun install` succeeds. No new source code. All tests green.

---

## Stage 2: packages/db — Adapter Interface & Entity Processing

**Goal:** Create the database-agnostic abstraction layer. New code only — additive, nothing moves from `src/`.

### Module: `base-adapter.js`

Create `BaseDatabaseAdapter` class (see 04-v2-architecture.md for full interface).

**Design decisions:**

- Constructor takes `(connectionString, options)` — options includes `{ verbose, dryRun }`
- Abstract methods throw `Error('not implemented')` — subclasses must override
- `applyEntity()` has default implementation: `generateEntityScript()` → `executeScript()`
- `applyEntities()` iterates sequentially (dependency order is caller's responsibility)
- `testConnection()` has default implementation using `inspect()`

### Module: `entity-processor.js`

Extract entity script generation logic. These are **pure functions** copied from `src/entity.js` (not moved — `src/` stays intact).

Functions to implement:

- `ddlFromEntity(entity)` — same logic as `src/entity.js:ddlFromEntity`
- `generateRoleScript(entity)` — same as `src/entity.js:getRoleScript`
- `importScriptForEntity(entity)` — same as `src/entity.js:importScriptForEntity`
- `exportScriptForEntity(entity)` — same as `src/entity.js:exportScriptForEntity`
- `combineEntityScripts(entities, options)` — combine DDL with optional comments
- `filterEntitiesForDBML(entities, config)` — same as `src/collect.js:entitiesForDBML`
- `cleanupDDLForDBML(ddl)` — strip indexes, procedures, complex constraints
- `validateEntity(entity)` — basic structural validation
- `organizeEntities(entities)` — group by type
- `getValidEntities(entities)` / `getInvalidEntities(entities)`

### Module: `dependency-resolver.js`

Extract dependency resolution logic. Pure functions copied from `src/metadata.js:organize/regroup`.

Functions to implement:

- `buildDependencyGraph(entities)` — adjacency list from `refers[]`
- `topologicalSort(graph)` — DFS-based ordering
- `findCycles(graph)` — cycle detection
- `validateDependencies(entities)` — check for cycles + missing deps
- `sortByDependencies(entities)` — main entry point
- `groupByDependencyLevel(entities)` — layered groups

### Module: `factory.js`

Adapter factory with dynamic imports.

### Tests

- `spec/entity-processor.spec.js` — test all pure functions with fixtures
- `spec/dependency-resolver.spec.js` — test sorting, cycle detection, missing deps
- `spec/base-adapter.spec.js` — test default implementations, abstract method throws

### Deliverable

`packages/db/` fully implemented and tested. `src/` unchanged. All existing tests + compat tests green.

---

## Stage 3: adapters/postgres — PostgreSQL Adapter

**Goal:** Implement PostgreSQL-specific adapter with programmatic DB access.

### Prerequisite: DB Library Decision

Evaluate and choose between:

1. `pg` + `pg-copy-streams` — proven, battle-tested COPY streaming
2. `postgres.js` — modern, fastest, built-in COPY
3. `@databases/pg` — safe SQL, used in feature branch

**Evaluation criteria:**

- Can stream CSV file → `COPY FROM STDIN` without temp files?
- Transaction API quality?
- Connection pooling built-in?
- Bun compatibility?
- Active maintenance?

**Document decision in `agents/memory.md`.**

### Module: `connection.js`

Wraps the chosen library:

- `connect()` / `close()` — connection lifecycle with pooling
- `query(sql, params)` — parameterized queries
- `transaction(fn)` — auto commit/rollback
- `copyFrom(table, readableStream, options)` — COPY FROM STDIN for bulk import
- `copyTo(table, writableStream, options)` — COPY TO STDOUT for export

### Module: `adapter.js`

`PostgreSQLAdapter extends BaseDatabaseAdapter`:

- `connect()` — creates connection pool via `connection.js`
- `executeScript(script)` — runs SQL programmatically (no psql, no temp files)
- `importData(entity)` — for CSV/TSV: streaming COPY; for JSON: temp table + procedure
- `exportData(entity)` — COPY TO streaming to file
- `inspect()` — version, database, user, capabilities

### Module: `scripts.js`

PostgreSQL-specific script generators (copied from `src/entity.js`, adapted):

- Same functions as `packages/db/entity-processor.js` but PG-specific where needed
- Shared logic stays in `packages/db`, PG-specific goes here

### E2E Test Infrastructure

Borrow from feature branch:

- Docker-based PostgreSQL setup/teardown
- `e2e/setup.js` — create test database, schemas
- `e2e/schema.e2e.spec.js` — create/drop schemas, extensions
- `e2e/tables.e2e.spec.js` — create tables, import data, export data
- `vitest.e2e.config.js` — separate config for e2e tests

### Deliverable

`adapters/postgres/` fully implemented and tested. Can perform all operations that current `psql` shelling does. `src/` unchanged. All tests green.

---

## Stage 4: packages/cli — Extract CLI

**Goal:** Build CLI package alongside `src/`. Old code stays untouched — the working CLI still runs from `src/`.

### Approach: build alongside, don't replace yet

1. **Copy, don't move** — create new files in `packages/cli/src/`, copying logic from `src/`
2. **Wire to new packages** — import from `@dbd/db`, `@dbd/parser`, `@dbd/dbml`
3. **Do NOT touch `src/`** — old CLI continues to work as-is
4. **Write package-level tests** in `packages/cli/spec/` that verify identical behavior
5. **Run both** old tests (`spec/*.spec.js`) and new tests — both must pass

### Module: `config.js`

Source: `src/metadata.js` + `src/filler.js`

```
metadata.read()          →  config.readConfig()
metadata.clean()         →  config.discoverEntities() + config.mergeEntities()
metadata.organize()      →  uses @dbd/db dependency-resolver
metadata.merge()         →  config.mergeEntities()
filler.fillMissing()     →  config.normalizeConfig()
```

### Module: `references.js`

Source: `src/parser.js` + `src/exclusions.js`

```
parser.parseEntityScript()     →  references.parseEntityScript()
parser.matchReferences()       →  references.matchReferences()
parser.extractReferences()     →  references.extractReferences()
parser.extractTableReferences() → references.extractTableReferences()
exclusions.isInternal()        →  references.isInternal()
```

**Note:** This is the legacy regex-based reference extractor (different from `packages/parser`). It finds function calls and table references in SQL scripts for dependency resolution.

### Module: `design.js`

Source: `src/collect.js`

The `Design` class is refactored to use:

- `config.readConfig()` instead of `metadata.read()`
- `@dbd/db` entity-processor for DDL generation
- `@dbd/db` dependency-resolver for ordering
- `createAdapter('postgres', url)` instead of `psql` shelling
- `@dbd/dbml` for DBML generation

### Module: `index.js`

Source: `src/index.js`

Same sade commands, same options. Imports `design.js` from this package.

### What stays untouched

- `src/` — all files remain, no modifications
- Root `package.json` `bin` — still points to `src/index.js`
- `spec/*.spec.js` — still import from `src/`, still pass

### Verification

1. All `spec/*.spec.js` pass (old tests, old imports, unchanged)
2. All `spec/compat/*.spec.js` pass
3. All `packages/cli/spec/*.spec.js` pass (new tests proving feature parity)
4. All other workspace tests pass
5. `bun run lint` — 0 errors

### Deliverable

`packages/cli/` fully implemented and tested alongside `src/`. Both old and new code coexist. Old CLI still works.

---

## Stage 5: DBML Extraction, Switchover & Old Code Removal

**Goal:** Extract DBML logic, switch the CLI entry point to packages, and delete `src/`.

This is the stage where coexistence ends and the new code takes over.

### Part A: DBML Package

Create `packages/dbml/src/index.js`:

```javascript
import { importer } from '@dbml/core'
import { filterEntitiesForDBML, cleanupDDLForDBML, ddlFromEntity } from '@dbd/db'

export function generateDBML(entities, config) {
  const filtered = filterEntitiesForDBML(entities, config)
  const ddl = filtered.map((e) => ddlFromEntity(e)).join('\n')
  const cleaned = cleanupDDLForDBML(ddl)
  const dbml = importer.import(cleaned, 'postgres')
  return replaceTableNames(dbml, filtered)
}

export function generateMultipleDBML(entities, dbdocsConfig) {
  return Object.entries(dbdocsConfig).map(([name, config]) => ({
    name,
    content: generateDBML(entities, config)
  }))
}
```

Wire into `packages/cli/src/design.js` for the `dbml()` command.

### Part B: Switchover (single commit)

Once `dbd-cli` passes all compatibility tests and side-by-side comparison with `dbd`:

1. **Rename binary** in `packages/cli/package.json` — change `"dbd-cli"` to `"dbd"`
2. **Remove `bin` and `main` from root `package.json`** — root is workspace-only, not a CLI
3. **Mark root `package.json` as `"private": true`** — prevent accidental publishing
4. **Delete `src/` entirely** — clean removal:
   - `src/index.js`
   - `src/collect.js`
   - `src/metadata.js`
   - `src/parser.js`
   - `src/entity.js`
   - `src/exclusions.js`
   - `src/filler.js`
   - `src/constants.js`
5. **Delete `spec/` legacy tests** — these tested `src/` internals, now replaced by:
   - `spec/compat/` — behavior tests (update imports to `packages/`)
   - `packages/*/spec/` — package-level tests
6. **Update `spec/compat/` imports** to reference `packages/` instead of `src/`
7. **Update root `vitest.config.js`** — point test includes to `spec/compat/` only

### Verification

1. All `spec/compat/*.spec.js` pass (now importing from packages)
2. All `packages/*/spec/*.spec.js` pass
3. `bun run lint` — 0 errors
4. CLI commands work end-to-end (manual smoke test)

### Deliverable

`src/` is gone. `spec/` legacy tests are gone. All code lives in `packages/` and `adapters/`. Clean break.

---

## Stage 6: Release Prep

**Goal:** Final polish and v2.0.0 release.

### Steps

1. **Version bump** — all packages to `2.0.0`
2. **README.md** — update with new architecture, installation, migration guide
3. **CHANGELOG.md** — document all changes from v1.3.2
4. **`docs/migration-v1-to-v2.md`** — guide for anyone importing from `src/`
5. **Update `agents/memory.md`** — reflect final architecture
6. **Final test run** — unit + compat + workspace + e2e
7. **Tag `v2.0.0`**

### Migration guide for users

```markdown
## For CLI users

No changes. `dbd` commands work exactly the same.

## For library users (importing from src/)

- `import { using } from '@jerrythomas/dbd/src/collect.js'`
  → `import { using } from '@dbd/cli'`
- `import { entityFromFile } from '@jerrythomas/dbd/src/entity.js'`
  → `import { entityFromFile } from '@dbd/db'`
- `psql` is no longer required — dbd uses programmatic database access
```

---

## Cherry-Pick Inventory from `feature/monorepo-refactor`

Code from the feature branch that can be adapted (not copied verbatim — the interfaces evolved):

| Feature Branch File                       | Target                                   | What to Reuse                                                       |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `packages/db/src/base-adapter.js`         | `packages/db/src/base-adapter.js`        | Interface design, method signatures                                 |
| `packages/db/src/entity-processor.js`     | `packages/db/src/entity-processor.js`    | `filterEntitiesForDBML`, `combineEntityScripts`, validation helpers |
| `packages/db/src/dependency-processor.js` | `packages/db/src/dependency-resolver.js` | `buildDependencyGraph`, `topologicalSort`, `findCycles`             |
| `adapters/postgres/src/adapter.js`        | `adapters/postgres/src/adapter.js`       | Class structure, method organization                                |
| `adapters/postgres/src/scripts.js`        | `adapters/postgres/src/scripts.js`       | Script generators (same logic as current src/entity.js)             |
| `adapters/postgres/e2e/`                  | `adapters/postgres/e2e/`                 | Docker setup, test structure                                        |
| `packages/parser/src/entity-analyzer.js`  | Evaluate for Stage 4                     | Could replace/enhance `src/parser.js` reference extraction          |

### What NOT to reuse

- Feature branch CLI — too coupled to unfinished DB package
- Feature branch root package.json — scripts diverged
- Feature branch docs/ — superseded by our derived docs
- `@databases/pg` usage — may switch to different library
- `connection.js` dual-mode (psql + programmatic) — we're going fully programmatic
