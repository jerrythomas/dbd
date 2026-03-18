# Project Journal

Chronological log of progress, milestones, and decisions.
Design details live in `docs/design/` — modular docs per module.

---

## 2026-03-15

### Complexity Reduction — Functions > 10

Executed plan `docs/superpowers/plans/2026-03-15-complexity-reduction.md` — 14 tasks, 4 chunks.

**Commits:** c4d4974 (translators), f7c277c (extractors), 5aff2dd (index-functional.js), 7506f28 (db/adapter/classifier)

**Reductions achieved (highlights):**

- extractors/tables.js `extractComments` 45→8, `extractColumnConstraints` 22→8
- index-functional.js `identifyEntity` 28→~5 (ENTITY_EXTRACTORS dispatch map), `collectReferences` 22→~5
- translators/create-table.js switch 14→dispatch + `translateCreateStmt` 25→~8
- translators/create-view.js `translateTargetExpr` 20→14 (partial — ESLint counts `&&`/`||`/`??`/`?.` operators)
- dependency-resolver.js `subgraphEntities` 16→~3

**Gap / next iteration:** ESLint counts logical operators (`&&`, `||`, `??`, `?.`) as branching points, so plan estimates were optimistic. 15 functions in production code remain > 10:

- `sql.js:41` splitStatements 36 (not in scope of this plan — from original sql.js)
- `extractors/tables.js` 5 functions at 12-14 (different from the 2 we targeted; same file but other functions)
- `extractors/views.js:182` 14, `extractors/procedures.js:219` 13
- `translators/create-view.js:22` 14 (targeted, reduced from 20, plan expected ~7 but `&&`/`||` inflate count)
- `translators/create-trigger.js:8` 12 (not in scope)
- `translators/create-table.js:197` 13 (different function from what we targeted)
- `entity-processor.js:207` validateEntity 12 (was 16, plan expected ~9)
- `dependency-resolver.js:152` bfsVisit 11 (new helper we created — complex by necessity)
- `translators/types.js:76` resolveAConstDefault 11 (new helper we created)
- `db-indexes.js:117` extractTableName 12 (was 11, `&&`/`||` inflate the early-return style)

All 684 workspace tests pass. Lint 0 errors.

---

### SQL Parser Modularization

Refactored `packages/postgres/src/parser/parsers/sql.js` (1080 lines, total complexity 227) into focused translator modules.

**New structure:** `packages/postgres/src/parser/translators/`

- `types.js` — PG_TYPE_MAP, resolveTypeName, resolveDefaultExpr
- `create-table.js` — translateCreateStmt + translateColumnConstraints + buildColumnCompatShape helpers
- `where-expr.js` — translateWhereExpr, translateFromItem, flattenJoinExpr (JOIN_TYPE_MAP extracted as constant)
- `create-view.js` — translateViewStmt + translateTargetExpr extracted
- `create-function.js` — translateCreateFunctionStmt + extractFunctionOptions + translateFunctionParameter
- `create-index.js`, `create-trigger.js`, `variable-set.js`, `comment.js` — single-responsibility translators
- `index.js` — translatePgStmt dispatcher

`parsers/sql.js` is now ~130 lines (public API only: parse, splitStatements, validateSQL, parseSearchPath, initParser) with scanDollarTag helper extracted from splitStatements.

All 684 workspace tests pass, 0 lint errors. Commit: `b38ff3c`

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

### Solution Directory + Vitest Consolidation

Created `solution/` as monorepo workspace root, matching strategos pattern. Consolidated vitest config.

**Structure changes:**

- Created `solution/` — workspace root with `package.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`
- Moved `packages/` → `solution/packages/`, `example/` → `solution/example/`
- Deleted legacy `.eslintrc` (superseded by flat config), `pnpm-lock.yaml` (using bun), `bunfig.toml` (unnecessary)
- Cleaned `.gitignore` — removed stale entries (`.nyc_output`, `.svelte-kit`)

**Vitest consolidation:**

- Replaced 5 identical per-package `vitest.config.js` files with single `solution/vitest.config.ts`
- Uses inline `projects` with `extends: true` — each project inherits shared defaults (pool, globals, include, timeout)
- Parser overrides `setupFiles` only; all other packages use pure inheritance
- Coverage configured with `packages/*/src/**/*.js` include pattern (no thresholds — aspirational)
- `packages/cli/vitest.e2e.config.js` kept separate (different include path and timeout)

**Result:** 333 tests passing, all `--project` filters work, single config file.

## 2026-02-18

### Parser Switch: node-sql-parser → pgsql-parser — COMPLETE

Replaced `node-sql-parser` with `pgsql-parser` (PostgreSQL C parser via WASM, libpg_query v17). This gives accurate, real PostgreSQL parsing instead of a permissive multi-dialect parser.

**Strategy:** Translation layer in `parsers/sql.js` — pgsql-parser AST is translated into the same normalized shape the existing extractors expect, minimizing downstream changes.

**Key changes:**

- `packages/parser/src/parsers/sql.js` — Complete rewrite (~1000 lines). Translates pgsql-parser AST nodes (CreateStmt, ViewStmt, CreateFunctionStmt, IndexStmt, CreateTrigStmt, VariableSetStmt, CommentStmt) into normalized shapes. Statement-level error isolation: tries full parse first, falls back to statement-by-statement on failure.
- `packages/parser/src/parser-utils.js` — Simplified from ~800 to ~100 lines. Now delegates all extraction to functional extractors instead of having its own implementations.
- `packages/parser/src/extractors/views.js` — Added `name` and `alias` to dependency objects for downstream consumers.
- `packages/parser/spec/setup.js` — Added `await initParser()` for WASM module initialization.
- `packages/parser/spec/procedure.spec.js` — Updated error handling test: pgsql-parser treats dollar-quoted body as opaque text, so PL/pgSQL body errors are NOT DDL-level errors.
- `packages/parser/package.json` — Removed `node-sql-parser`, kept `pgsql-parser`.

**pgsql-parser v17 gotchas resolved:**

- `parseSync()` returns `{version, stmts: [{stmt, stmt_len}]}` not `[{RawStmt: {stmt}}]`
- Constants are double-nested: `A_Const.ival.ival`, `A_Const.sval.sval`, `A_Const.boolval.boolval`
- Type names via pg_catalog: `pg_catalog.varchar` → mapped to short `varchar`
- JOIN types are strings: `JOIN_INNER`, `JOIN_LEFT` (not numeric)
- Boolean ops are strings: `AND_EXPR`, `OR_EXPR` (not numeric)
- Procedure body in `DefElem.arg.List.items[0].String.sval`
- Schema-qualified index names are invalid PostgreSQL syntax (correctly rejected)

**Test results:** 115 parser tests passing (was 114 + 1 new), 333 total workspace tests, 0 lint errors.

### Workspace Restructure: Strategos-Style Configuration

Reorganized the monorepo to use a single `packages/*` workspace with workspace-aware vitest.

**Changes:**

- Moved `adapters/postgres` → `packages/postgres` — single workspace root
- Relocated root `spec/fixtures/` into owning packages (`db`, `cli`) — each package self-contained
- Deleted orphaned fixtures: `references/`, `metadata/`, loose YAML files
- Added `vitest.config.ts` with `projects: ['packages/*']` — workspace-aware test discovery
- Added `name` field to each per-package vitest config — enables `--project parser` shorthand
- Added 80% coverage thresholds to all per-package vitest configs
- Simplified root scripts: `test` → `vitest run`, `coverage` → `vitest run --coverage`
- Removed per-package devDeps (vitest, eslint, prettier) — all test infra root-only
- Updated `CLAUDE.md` docs (structure, commands, file table)

**Result:** 333 tests passing via single `bun test` command, 0 lint errors, clean workspace layout.

### Fix Console Noise in Parser Tests

Replaced hardcoded `console.warn`/`console.error` calls in `parser-utils.js` (the OOP `SQLParser` class) with `errorHandler.handleParsingError()`. These were bypassing the error handler configured as silent in tests, causing stderr output during test runs. Zero stderr blocks in test output now.

### DB-Backed Reference Validation Cache

Added optional database catalog verification for unresolved references in `dbd inspect`.

**Architecture:**

- `BaseDatabaseAdapter.resolveEntity(name, searchPaths)` — new method, returns null by default
- `PsqlAdapter.resolveEntity()` — queries `pg_catalog.pg_class` (tables/views) and `pg_catalog.pg_proc` (functions/procedures)
- `DbReferenceCache` (`packages/cli/src/db-cache.js`) — in-memory + file cache (`~/.config/dbd/cache/`) keyed by SHA-256 of connection URL
- `resolveWarnings(entities, dbResolver)` — async function that re-resolves references with warnings against the database
- `Design.updateEntities()` — updates config entities after async DB resolution
- CLI `inspect` command: when `-d` option provided, resolves warnings against DB, `--no-cache` flag to bypass cache

**Tests:** `spec/db-cache.spec.js` — 10 tests (cache hit/miss, null caching, resolveWarnings with mock adapter)

### Classify Unresolved References as Warnings

Changed `findEntityByName()` to return `warning` instead of `error` for unresolved references. Added `matchesKnownExtension()` for extension detection without requiring them to be declared. Updated `matchReferences()` and `report()` to collect and display warnings separately. Added missing extensions (pgmq, pg_cron, dblink, pg_background, hnsw/ivfflat). Updated legacy `src/` code in sync. Commit `7bc837e`.

### Replace Regex Reference Extraction with AST Parser

Major migration: replaced regex-based `parseEntityScript()` with AST-based extraction using `extractDependencies()` from `@jerrythomas/dbd-parser`.

**Parser changes (`packages/parser/`):**

- Extended `procedures.js` to handle `CREATE FUNCTION` — different AST shape (`stmt.name.name[0].value`, `stmt.args`, `stmt.options`)
- Added `extractBodyReferencesFromAst()` for functions with AST-parsed bodies
- Improved `extractTableReferencesFromBody()` regex fallback: removed bare `INTO` (PL/pgSQL variable assignments), added comment/string stripping, expanded non-table-word filter
- Created `triggers.js` — regex-based trigger extractor (node-sql-parser doesn't support CREATE TRIGGER)
- Added `extractSearchPaths()` (plural) returning full array
- Fixed `extractViewDependencies()` to exclude CTE aliases and include CTE body dependencies
- Added `extractDependencies()`, `identifyEntity()`, `collectReferences()` to functional API

**CLI changes (`packages/cli/`):**

- `parseEntityScript()` now calls AST-based `parseEntityScriptAST()` first, falls back to `parseEntityScriptRegex()` on failure
- Marked regex extraction functions as `@deprecated`
- No changes to `matchReferences()`, `sortByDependencies()`, or `config.js`

**New tests:** `triggers.spec.js` (7), `dependencies.spec.js` (16)

**FizzBot results:** Zero warnings on `.ddl` files (down from ~30+ false positives). Only remaining items are legitimate errors (`.sql` files unsupported as DDL type).

### Inspect Command: Warnings vs Errors — COMPLETE

Improved `inspect` command to classify unresolved references as warnings instead of errors. Commit `7bc837e`.

**Problem:** The regex-based reference extractor produced many false positives — function parameter names (`level`, `message`, `name`), SQL keywords (`between`, `columns`, `default`), and extension functions (`pgmq.*`, `cron.*`, `dblink_exec`) were all reported as hard errors, making the output noisy and unhelpful.

**Changes:**

- Added missing extensions to exclusion list: `pgmq`, `pg_cron`, `dblink`, `pg_background`; added `hnsw`/`ivfflat` to `vector`
- Added common false-positive SQL keywords to ANSI internals: `between`, `columns`, `default`, `system`, `user`
- New `matchesKnownExtension()` function checks ALL known extensions regardless of install status
- `findEntityByName()` now returns `warning` instead of `error` for unresolved references, with specific messages for undeclared extensions ("may require undeclared extension 'pgmq'")
- `matchReferences()` collects warnings into a separate `warnings` array on entities
- `report()` returns `{ entity, issues, warnings }` — backwards compatible addition
- `inspect` command displays Errors and Warnings in separate labeled sections
- Updated both `packages/cli/` and legacy `src/` code to stay in sync
- All fixtures updated for `error` → `warning` and new `warnings` arrays

**Result on FizzBot database:**

- Before: 30+ entities shown as errors (all mixed together)
- After: 12 real errors (structural: unsupported file types, unnecessary extension DDL) + 17 warnings (unresolved refs clearly categorized with extension hints)

All 492 tests pass (222 legacy + 99 db + 45 cli + 35 dbml + 91 parser).

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

### Stage 6: Cleanup & v2.0.0 Release Prep — COMPLETE

Release preparation. Commit `e5b3a71`.

- Bumped all workspace packages from `2.0.0-alpha.0` to `2.0.0`
- Root package: `2.0.0`, `private: true` (workspace-only)
- Updated README.md with v2 architecture, package table, dependency flow, dev commands
- Updated `agents/memory.md` with final status, package summary, test counts
- Final test run: **417 tests passing** (222 legacy/compat + 99 db + 45 cli + 22 dbml + 29 postgres)

**v2.0.0 migration complete.** All 7 stages (0–6) done. Legacy `src/` retained for compat tests.

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

### Import env mode (dev/prod) — COMPLETE (2026-03-18)

Implemented environment-aware import so different tables and post-import scripts run per environment.

**Features:**
- `normalizeEnv()` utility maps `dev`/`development`/`prod`/`production` aliases; returns `'prod'` for null/undefined; throws on unknown values
- `envFromPath()` annotates filesystem-discovered import entities (position-aware: `import/dev/` → `'dev'`, `import/prod/` → `'prod'`, other → `null`)
- `normalizeYamlEnv()` handles YAML `env:` field — string, `[dev, prod]` array (→ null/shared), absent (→ null)
- `Design#env` stores active environment; `validate()` filters import tables to matching env + shared (`env === null`)
- `importData()` runs shared `after`, then env-specific `after.dev`/`after.prod` scripts
- CLI `-e` default changed from `'development'` to `'prod'`; wired through `normalizeEnv()` to `using()`

**Commits:** e6f723c ← d3d151e ← c2264f7 ← 1e37037 ← f9dcff9 ← 4fb18f6 ← 2b75c7a ← 2883395 (+ earlier)
