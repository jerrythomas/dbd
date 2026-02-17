# Project Journal

Chronological log of progress, milestones, and decisions.
Design details live in `docs/design/` — modular docs per module.

---

## 2026-02-17

### Agent Workflow Setup

- Migrated from `.rules/` folder to `agents/` workflow structure
- Created CLAUDE.md entry point, agents/ files, docs/requirements and docs/design structure
- Retained all project knowledge from .rules into agents/memory.md and design-patterns.md
- Added brownfield workflow for deriving documentation from existing code

### Documentation Derivation

Derived requirements and design docs from existing codebase:

**Requirements (docs/requirements/):**

- `01-parser.md` — Parser package: schema extraction, validation, dual API, supported SQL features, known limitations
- `02-cli.md` — CLI: all 7 commands (init, inspect, apply, combine, import, export, dbml), global options, config format, validation rules
- `03-dbml.md` — DBML generation: SQL-to-DBML conversion, multi-document support, filtering

**Design (docs/design/):**

- `01-parser.md` — Three-layer pipeline architecture, module map, output shapes, error handling, fallback extraction
- `02-cli.md` — Design class orchestration, configuration pipeline, reference extraction, entity lifecycle, execution via psql, technical debt
- `03-configuration.md` — design.yaml full schema, project directory layout, entity type system, import flow, DBML config

### v2.0.0 Migration Planning

Explored `feature/monorepo-refactor` branch (10 commits, 22K lines added):

- Has partial monorepo: packages/cli, packages/db, adapters/postgres
- BaseDatabaseAdapter interface, PostgreSQLAdapter with dual psql/@databases/pg execution
- Entity processor, schema transformer, dependency processor
- Parser entity-analyzer (672 lines)
- E2E test infrastructure with Docker
- Branch diverged significantly — cherry-pick useful parts, don't merge

Researched DB libraries:

- `@databases/pg` — used in feature branch, safe API, COPY support unclear
- `postgres.js` (porsager) — fastest, Bun/Deno support, built-in COPY
- `pg` + `pg-copy-streams` — most popular, proven COPY streaming
- `dbdocs` — CLI only, no programmatic API found

Created 7-batch migration plan (agents/plan.md):

- Batch 0: Compatibility test suite (safety net before any refactoring)
- Batch 1: Monorepo infrastructure
- Batch 2: DB adapter interface (packages/db)
- Batch 3: PostgreSQL adapter (adapters/postgres)
- Batch 4: Extract CLI package
- Batch 5: DBML extraction + src/ cleanup
- Batch 6: v2.0.0 release prep

Updated backlog with cherry-pick inventory, library evaluation criteria, and future work items.

### v2.0.0 Architecture & Migration Design Docs

Wrote detailed design documents for review:

- `docs/design/04-v2-architecture.md` — target architecture:

  - Package dependency diagram (cli → parser, db, dbml; db → no deps; adapters → db)
  - Full API specifications for each package (BaseDatabaseAdapter, entity-processor, dependency-resolver, factory)
  - Entity object shape (unchanged from v1)
  - PostgreSQLAdapter with connection.js wrapping chosen DB library
  - 5 design patterns: Adapter, Entity Pipeline, Structured Error Collection, Dry Run/Verbose, Script Generation as Pure Functions
  - Target file structure
  - User-facing breaking changes summary

- `docs/design/05-v2-migration-stages.md` — detailed 7-stage plan:
  - Stage 0: Compatibility test suite with ~50 tests (example code for each test file)
  - Stage 1: Monorepo infrastructure (package.json specs for each package)
  - Stage 2: packages/db with entity-processor and dependency-resolver
  - Stage 3: adapters/postgres with DB library evaluation criteria
  - Stage 4: packages/cli extraction (copy-then-move approach)
  - Stage 5: DBML extraction + src/ cleanup
  - Stage 6: Release prep with migration guide
  - Cherry-pick inventory: what to reuse vs what to skip from feature branch

Read full feature branch source: base-adapter.js, entity-processor.js, dependency-processor.js, adapter.js, connection.js, scripts.js — informed the design but interfaces were refined.

### Stage 0: Compatibility Test Suite — COMPLETE

Wrote 136 compatibility tests across 4 files in `spec/compat/`:

| File                             | Tests | Coverage                                                                                                                                                                                               |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec/compat/design.spec.js`     | 37    | Design class: init, config loading, entity discovery, dependency order, validation, combine, dbml, dry-run, bad-example errors                                                                         |
| `spec/compat/references.spec.js` | 29    | Reference extraction: extractReferences, extractTableReferences, extractTriggerReferences, searchPaths, CTE aliases, parseEntityScript, matchReferences, lookup tree, DDL cleanup                      |
| `spec/compat/entity.spec.js`     | 42    | Entity transforms: entityFromFile (all patterns), entityFrom\*Config factories, ddlFromEntity (all types), validateEntityFile, importScriptForEntity, exportScriptForEntity, entitiesForDBML filtering |
| `spec/compat/config.spec.js`     | 28    | Config loading: scan, read, clean, merge, organize, regroup, fillMissingInfoForEntities, dependency ordering, cycle detection                                                                          |

Also:

- Added `test:compat` script to root package.json
- All 222 tests pass (86 existing + 136 compat)
- Prettier clean on all new files

### Stage 1: Monorepo Infrastructure — COMPLETE

Updated workspace packages for v2.0.0 migration:

- All packages bumped to `2.0.0-alpha.0`
- Fixed dependency wiring per design:
  - `packages/db` — no external deps (pure abstractions)
  - `packages/dbml` — depends on `@jerrythomas/dbd-db` + `@dbml/core`
  - `packages/cli` — depends on parser + db + dbml + sade/yaml/ramda, bin renamed to `dbd-cli`
  - `adapters/postgres` — depends on `@jerrythomas/dbd-db` (PG lib deferred to Stage 3)
- Created placeholder `src/index.js` for cli, db, dbml, postgres adapter
- Recorded naming decision: `@jerrythomas/dbd-*` (no access to `@dbd` npm scope)
- `bun install` resolves all workspaces, 222 tests + parser workspace tests pass

### Stage 3: PostgreSQL Adapter (PsqlAdapter plugin) — COMPLETE

Implemented `adapters/postgres/` with PsqlAdapter and plugin system. Decision: keep psql as default, allow alternative adapters via `registerAdapter()`.

**Key decision:** Instead of replacing psql with a programmatic DB library immediately, wrap the existing psql CLI as the first adapter plugin. This gives us the adapter abstraction while keeping the proven psql approach as default. Alternative adapters (pg, postgres.js, etc.) can be plugged in later via `registerAdapter()`.

**Modules:**

- `psql-adapter.js` — `PsqlAdapter extends BaseDatabaseAdapter`. Stateless adapter wrapping `execSync('psql ...')`. Methods: connect/disconnect (no-op), executeScript (temp file → psql stdin), executeFile (direct), applyEntity (file-backed or generated DDL), importData/exportData (via entity-processor scripts), testConnection/inspect (via `psql -c`), dryRun support.
- `index.js` — Exports `PsqlAdapter` and `createAdapter()` factory function.
- `factory.js` (packages/db) — Added `registerAdapter(type, loader)` for plugin support. Updated index.js re-exports.

**Tests:**

- `adapters/postgres/spec/psql-adapter.spec.js` — 26 tests with mocked execSync/fs
- `adapters/postgres/spec/index.spec.js` — 3 tests for factory exports
- `packages/db/spec/factory.spec.js` — 3 new tests for registerAdapter (now 10 total)

All 222 existing tests + 99 db tests + 29 adapter tests green.

### Stage 2: Extract Database Adapter Interface — COMPLETE

Implemented `packages/db/` with 4 modules and 96 unit tests. Commit `a643b18`.

**Modules:**

- `base-adapter.js` — `BaseDatabaseAdapter` abstract class with private fields, default implementations for `testConnection()`, `applyEntities()`, `batchImport()`, `batchExport()`, and `log()`. Abstract methods throw `'not implemented'`.
- `entity-processor.js` — Pure functions copied from `src/entity.js` + `src/constants.js`. All entity factories, DDL generation, import/export script generation, DBML filtering, validation, and organization.
- `dependency-resolver.js` — Pure functions from `src/metadata.js` organize/regroup. `buildDependencyGraph()`, `sortByDependencies()`, `groupByDependencyLevel()`, `findCycles()`, `validateDependencies()`.
- `factory.js` — `createAdapter()` with dynamic import, `getAdapterInfo()`, `SUPPORTED_DATABASES`.
- `index.js` — Re-exports all public API.

**Tests (96 total):**

- `spec/base-adapter.spec.js` — 20 tests: constructor, abstract throws, testConnection, batch ops, logging
- `spec/entity-processor.spec.js` — 53 tests: constants, factories, DDL generation (via fixtures), import/export scripts, DBML filtering, validation, organization
- `spec/dependency-resolver.spec.js` — 16 tests: graph building, cycle detection, validation, sorting, grouping
- `spec/factory.spec.js` — 7 tests: supported databases, adapter info, error on unsupported

All 222 existing tests remain green. New code is purely additive — `src/` untouched.

### Stage 5: DBML & Documentation Generation — COMPLETE

Extracted DBML conversion into `packages/dbml/`. Commit `e6258ab`.

**Modules:**

- `converter.js` — DDL cleanup functions (removeCommentBlocks, removeIndexCreationStatements, normalizeComment, cleanupDDLForDBML), schema-qualified table replacements (buildTableReplacements, applyTableReplacements), project block generation (buildProjectBlock), SQL→DBML conversion (convertToDBML via @dbml/core), and `generateDBML()` orchestrator that takes entities + project config + function deps and returns `[{fileName, content}]`.

**Changes:**

- `packages/cli/src/design.js` — `dbml()` method now delegates to `generateDBML()`, removing ~40 lines of inline logic. Removed `@dbml/core` import and `rmSync` import.
- `packages/cli/package.json` — removed direct `@dbml/core` dependency (goes through `@jerrythomas/dbd-dbml`).

**Tests (22 total):**

- `spec/converter.spec.js` — 22 tests: DDL cleanup (9), table replacements (6), project block (1), convertToDBML (2), generateDBML (4)

All 222 existing tests + 45 CLI tests remain green.

### Separate e2e tests from unit tests

Moved PostgreSQL integration tests out of `spec/` into `e2e/`:

- `spec/collect.spec.js` → `e2e/collect.spec.js` (updated fixture import path)
- Created `vitest.e2e.config.js` — includes `e2e/**/*.spec.js`, 30s timeout
- `vitest.config.js` unchanged — `spec/**/*.spec.js` naturally excludes `e2e/`
- Updated scripts:
  - `test:unit` — runs `spec/` only (222 tests, no PG needed)
  - `test:e2e` — runs `e2e/` via `vitest.e2e.config.js` (requires Docker PG)
  - `test:pg` — starts PG, runs e2e, stops PG
  - `test` — full suite: PG + unit + e2e + cleanup
  - Removed `test:nopg` — `test:unit` now serves this purpose

### Stage 3: PostgreSQL Adapter — COMPLETE

Implemented PsqlAdapter as default plugin in `adapters/postgres/`. Commit `acee3ff`.

- `psql-adapter.js` — PsqlAdapter extends BaseDatabaseAdapter, wraps `execSync('psql ...')`
- `index.js` — exports PsqlAdapter + createAdapter factory
- Added `registerAdapter()` to `packages/db/src/factory.js` for plugin system
- 29 adapter tests + 3 factory plugin tests, all passing

### Stage 4: Extract CLI Package — COMPLETE

Extracted CLI logic from `src/` into `packages/cli/`. Commit `abbb7aa`.

**Modules:**

- `config.js` — scan/read/clean/merge from `src/metadata.js` + `src/filler.js`. `clean()` uses dependency injection for `parseEntityScript` and `matchReferences`.
- `references.js` — exclusions + parsing from `src/parser.js` + `src/exclusions.js` (~565 lines). All extraction, matching, and cleanup functions.
- `design.js` — Design class from `src/collect.js`. Uses `@jerrythomas/dbd-db` for entity processing and dependency resolution. `apply()`, `importData()`, `exportData()` are now async (adapter-based). Lazy adapter creation via `getAdapter()`.
- `index.js` — sade CLI with 7 commands: init, inspect, apply, combine, import, export, dbml.

**Tests (45 total):**

- `spec/config.spec.js` — 8 tests: scan, read, fillMissingInfoForEntities, merge
- `spec/references.spec.js` — 21 tests: internals, extensions, extraction, matching, cleanup
- `spec/design.spec.js` — 16 tests: mirrors compat/design tests with new package imports

All 222 existing tests remain green. New code is purely additive — `src/` untouched.
