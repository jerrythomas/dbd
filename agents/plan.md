# Plan: DBD v2.0.0 Migration

## Context

Migrate from monolithic `src/` (v1.3.2) to a proper monorepo with packages and adapters. The `feature/monorepo-refactor` branch has partial work (10 commits, 22K lines changed) that we can cherry-pick from but not merge directly — it diverged significantly and was never completed.

### Goals
- Proper monorepo: `packages/` for core logic, `adapters/` for database-specific code
- `packages/parser` — SQL parsing (already mature on develop)
- `packages/cli` — CLI interface
- `adapters/postgres` — PostgreSQL adapter (replaces psql shelling out)
- Feature-compatible with v1.3.2 between each batch
- Replace `psql` CLI dependency with programmatic DB access
- Each batch is a committable, working state

### Key Decisions Needed
- DB library: `@databases/pg` (already used in feature branch) vs `postgres.js` (faster, COPY support) vs `pg` + `pg-copy-streams`
- DBML: keep `@dbml/core` importer (works), `dbdocs` CLI for publishing (no programmatic API found)
- Adapter interface: borrow `BaseDatabaseAdapter` from feature branch, refine

---

## Batch Plan

### Batch 0: Compatibility Test Suite (FIRST — do this before any refactoring)

Write tests against the current working v1.3.2 code that capture ALL existing behavior. These tests become the contract that every subsequent batch must satisfy.

- [x] **0.1** Catalog all current behaviors from specs + manual testing
  - CLI commands: init, inspect, apply, combine, import, export, dbml
  - Configuration loading: design.yaml parsing, file discovery, entity merging
  - Reference resolution: function refs, table refs, trigger refs, CTE filtering
  - Dependency ordering: topological sort, cycle detection
  - Entity validation: file checks, naming, schema rules
  - DDL generation: schema, extension, role, file-backed entities
  - Import/export script generation: CSV, TSV, JSON, JSONL formats
  - DBML generation: filtering, schema qualification, index removal

- [x] **0.2** Write integration tests for `Design` class (collect.js)
  - spec/compat/design.spec.js — 37 tests
  - using() factory with example/ fixtures
  - validate() → report() round-trip
  - combine() output matches expected DDL
  - dbml() output is valid DBML
  - import/export script generation (dry-run mode)
  - bad-example validation errors

- [x] **0.3** Write snapshot tests for parser.js (legacy reference extractor)
  - spec/compat/references.spec.js — 29 tests
  - extractReferences() with known SQL → expected refs
  - extractTableReferences() with known SQL → expected table refs
  - matchReferences() with known entity set → resolved refs
  - parseEntityScript() for each entity type
  - cleanupDDLForDBML(), removeCommentBlocks(), normalizeComment()

- [x] **0.4** Write snapshot tests for entity.js transformations
  - spec/compat/entity.spec.js — 42 tests
  - entityFromFile() for all path patterns
  - entityFrom*Config() factories
  - ddlFromEntity() for each entity type
  - importScriptForEntity() for each format
  - exportScriptForEntity() for each format
  - validateEntityFile() for valid and invalid entities
  - entitiesForDBML() filtering

- [x] **0.5** Write snapshot tests for config loading (metadata.js, filler.js)
  - spec/compat/config.spec.js — 28 tests
  - scan(), read(), clean(), merge(), organize(), regroup()
  - fillMissingInfoForEntities()
  - Dependency ordering, cycle detection

- [x] **0.6** Ensure all tests pass, add test:compat script
  - 86 existing tests — all green
  - 136 new compat tests — all green
  - 222 total tests passing
  - Added `test:compat` script to package.json
  - Prettier passes on all compat files

---

### Batch 1: Monorepo Infrastructure

Set up workspace structure without moving any code. Everything still works through `src/`.

- [ ] **1.1** Configure root package.json workspaces: `["packages/*", "adapters/*"]`
- [ ] **1.2** Create `packages/cli/package.json` with proper dependencies
- [ ] **1.3** Create `packages/db/package.json` with proper dependencies
- [ ] **1.4** Create `adapters/postgres/package.json` with proper dependencies
- [ ] **1.5** Update `packages/parser/package.json` — ensure it works standalone
- [ ] **1.6** Add workspace test scripts: `test:parser`, `test:cli`, `test:db`, `test:postgres`
- [ ] **1.7** Verify: `bun install` succeeds, all existing tests still pass

---

### Batch 2: Extract Database Adapter Interface

Create `packages/db` with the adapter abstraction. No code moves from `src/` yet — this is new code.

- [ ] **2.1** Create `packages/db/src/base-adapter.js` — abstract adapter interface
  - Methods: connect, disconnect, executeScript, importData, exportData, testConnection
  - Borrow interface design from feature branch, simplify
- [ ] **2.2** Create `packages/db/src/index.js` — adapter factory
  - `createAdapter(type, connectionString, options)` → adapter instance
  - Dynamic import of adapter packages
- [ ] **2.3** Create `packages/db/src/entity-processor.js` — entity DDL generation
  - Extract `ddlFromEntity()`, `importScriptForEntity()`, `exportScriptForEntity()` logic
  - Keep as pure functions (no DB dependency)
- [ ] **2.4** Create `packages/db/src/dependency-resolver.js` — topological sort
  - Extract from `metadata.organize()` / `metadata.regroup()`
  - Cycle detection, group ordering
- [ ] **2.5** Write unit tests for all new modules
- [ ] **2.6** Verify: all existing tests still pass (new code is additive)

---

### Batch 3: PostgreSQL Adapter

Create `adapters/postgres` with programmatic DB access replacing `psql` shelling.

- [ ] **3.1** Choose DB library — evaluate `@databases/pg` vs `postgres.js` vs `pg` + `pg-copy-streams`
  - Criteria: COPY support, streaming, transaction API, maintenance activity
  - Decide and document in `agents/memory.md`
- [ ] **3.2** Create `adapters/postgres/src/adapter.js` — implements base adapter
  - connect/disconnect with connection pooling
  - executeScript — run DDL/SQL programmatically
  - testConnection — verify connectivity
- [ ] **3.3** Create `adapters/postgres/src/importer.js` — bulk data loading
  - CSV/TSV via COPY (streaming, not temp files)
  - JSON/JSONL via staging table + procedure call
  - Truncate support
- [ ] **3.4** Create `adapters/postgres/src/exporter.js` — data export
  - COPY TO for CSV/TSV/JSON formats
- [ ] **3.5** Write unit tests + integration tests (Docker-based PostgreSQL)
  - Borrow e2e setup from feature branch
- [ ] **3.6** Verify: adapter can perform all operations that `psql` shelling currently does

---

### Batch 4: Extract CLI Package

Move CLI logic from `src/` to `packages/cli/`, wiring it to the new adapter.

- [ ] **4.1** Create `packages/cli/src/index.js` — sade command definitions
  - Same commands, same options, same behavior
  - Import from `@dbd/db` and `@dbd/parser` instead of `src/` modules
- [ ] **4.2** Create `packages/cli/src/design.js` — refactored Design class
  - Use `@dbd/db` adapter factory instead of psql
  - Use `@dbd/db` entity-processor and dependency-resolver
  - Keep metadata.js logic (config reading, file discovery, merging)
- [ ] **4.3** Create `packages/cli/src/config.js` — configuration handling
  - Extract from `src/metadata.js`: read(), clean(), merge(), organize()
  - Extract from `src/filler.js`: fillMissingInfoForEntities()
- [ ] **4.4** Create `packages/cli/src/references.js` — reference extraction
  - Extract from `src/parser.js`: extractReferences(), matchReferences(), etc.
  - Extract from `src/exclusions.js`: isInternal(), extension patterns
- [ ] **4.5** Update root `src/index.js` to re-export from `@dbd/cli`
  - Backwards-compatible entry point
- [ ] **4.6** Run Batch 0 compatibility tests — everything must pass
- [ ] **4.7** Run all workspace tests — everything must pass

---

### Batch 5: DBML & Documentation Generation

Extract DBML logic, clean up remaining `src/` code.

- [ ] **5.1** Move DBML generation into `packages/db/src/dbml.js` (or `packages/cli/src/dbml.js`)
  - entitiesForDBML() filtering
  - Index statement removal
  - @dbml/core importer usage
  - Schema-qualified name replacement
- [ ] **5.2** Write tests for DBML generation
- [ ] **5.3** Deprecate/remove legacy `src/` modules that have been fully extracted
  - Keep `src/index.js` as thin re-export shim for backwards compat
- [ ] **5.4** Run full test suite — Batch 0 compat tests + all workspace tests

---

### Batch 6: Cleanup & v2.0.0 Release Prep

- [ ] **6.1** Update all package.json versions to 2.0.0
- [ ] **6.2** Update README.md with new architecture
- [ ] **6.3** Update `docs/` with installation and migration guide (v1 → v2)
- [ ] **6.4** Update `agents/memory.md` with final architecture
- [ ] **6.5** Final test run: unit + integration + e2e
- [ ] **6.6** Tag and release

---

## Verification

Each batch must satisfy:
1. All existing tests pass (`bun test:unit`, `bun test:nopg`)
2. Batch 0 compatibility tests pass (once written)
3. New workspace tests pass
4. `bun run lint` — 0 errors

## Current Batch: 0 COMPLETE → Next: Batch 1 (Monorepo Infrastructure)

Batch 0 delivered 136 compatibility tests across 4 files in `spec/compat/`.
No refactoring until the safety net is in place — and it now is.
