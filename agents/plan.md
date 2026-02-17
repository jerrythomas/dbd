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
  - entityFrom\*Config() factories
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

### Batch 1: Monorepo Infrastructure — COMPLETE

Set up workspace structure without moving any code. Everything still works through `src/`.

- [x] **1.1** Root package.json workspaces already configured: `["packages/*", "adapters/*"]`
- [x] **1.2** `packages/cli/package.json` — v2.0.0-alpha.0, bin: `dbd-cli`, deps on parser+db+dbml+sade+yaml+ramda
- [x] **1.3** `packages/db/package.json` — v2.0.0-alpha.0, no external deps (pure abstractions)
- [x] **1.4** `packages/dbml/package.json` — v2.0.0-alpha.0, deps on dbd-db + @dbml/core
- [x] **1.5** `adapters/postgres/package.json` — v2.0.0-alpha.0, deps on dbd-db (PG lib added in Stage 3)
- [x] **1.6** `packages/parser/package.json` — v2.0.0-alpha.0, standalone
- [x] **1.7** Placeholder `src/index.js` for cli, db, dbml, postgres adapter
- [x] **1.8** Workspace test scripts already present: test:parser, test:cli, test:db, test:postgres, test:workspaces
- [x] **1.9** Verify: `bun install` succeeds, 222 tests pass, parser workspace tests pass
- [x] **1.10** Recorded `@jerrythomas/dbd-*` naming decision in memory.md

---

### Batch 2: Extract Database Adapter Interface

Create `packages/db` with the adapter abstraction. No code moves from `src/` yet — this is new code.

- [x] **2.1** Create `packages/db/src/base-adapter.js` — abstract adapter interface
  - BaseDatabaseAdapter: connect, disconnect, executeScript, applyEntity/applyEntities, importData/exportData, batchImport/batchExport, testConnection, inspect, log
  - Default implementations for testConnection (via inspect), applyEntities/batch (sequential iteration)
- [x] **2.2** Create `packages/db/src/factory.js` + `packages/db/src/index.js`
  - `createAdapter(type, connectionString, options)` → dynamic import of adapter packages
  - `getAdapterInfo()`, `SUPPORTED_DATABASES`
  - index.js re-exports all public API from all modules
- [x] **2.3** Create `packages/db/src/entity-processor.js` — entity DDL generation
  - Pure functions copied from `src/entity.js` + `src/constants.js`
  - entityFromFile, entityFrom\*Config, ddlFromEntity, generateRoleScript, combineEntityScripts
  - importScriptForEntity, exportScriptForEntity, filterEntitiesForDBML
  - validateEntity, getValidEntities, getInvalidEntities, organizeEntities
- [x] **2.4** Create `packages/db/src/dependency-resolver.js` — topological sort
  - Pure functions from `src/metadata.js:organize/regroup`
  - buildDependencyGraph, sortByDependencies, groupByDependencyLevel
  - findCycles, validateDependencies
- [x] **2.5** Write unit tests for all new modules
  - 96 tests across 4 spec files (base-adapter, entity-processor, dependency-resolver, factory)
- [x] **2.6** Verify: all existing tests still pass (222 unit + 96 db = 318 total)

---

### Batch 3: PostgreSQL Adapter

Create `adapters/postgres` with psql adapter as default plugin. Plugin system for alternative adapters.

- [x] **3.1** Decision: keep `psql` as default adapter (already works); plugin system via `registerAdapter()`
  - PsqlAdapter wraps existing `execSync('psql ...')` pattern
  - Alternative programmatic adapters (pg, postgres.js) can be registered later
  - Documented in `agents/memory.md`
- [x] **3.2** Create `adapters/postgres/src/psql-adapter.js` — PsqlAdapter extends BaseDatabaseAdapter
  - connect/disconnect (stateless for psql)
  - executeScript — writes temp file, feeds to psql
  - executeFile — runs DDL file directly via psql
  - applyEntity — file-backed or generated DDL
  - importData/exportData — generate scripts via entity-processor, execute via psql
  - testConnection/inspect — via `psql -c "SELECT ..."`
  - dryRun support at both instance and per-call level
- [x] **3.3** Create `adapters/postgres/src/index.js` — exports PsqlAdapter + createAdapter factory
- [x] **3.4** Add `registerAdapter()` to `packages/db/src/factory.js`
  - Allows overriding built-in adapters or adding new ones
  - Updated index.js re-exports
- [x] **3.5** Write unit tests (29 adapter tests + 3 factory plugin tests)
  - spec/psql-adapter.spec.js — 26 tests with mocked execSync/fs
  - spec/index.spec.js — 3 tests for factory exports
  - packages/db/spec/factory.spec.js — 3 new tests for registerAdapter
- [x] **3.6** Verify: all 222 existing tests pass, 99 db tests pass, 29 adapter tests pass

---

### Batch 4: Extract CLI Package

Move CLI logic from `src/` to `packages/cli/`, wiring it to the new adapter.

- [x] **4.1** Create `packages/cli/src/index.js` — sade command definitions
  - 7 commands: init, inspect, apply, combine, import, export, dbml
  - Imports from `@jerrythomas/dbd-db` and local modules
- [x] **4.2** Create `packages/cli/src/design.js` — refactored Design class
  - Uses `@jerrythomas/dbd-db` adapter factory, entity-processor, dependency-resolver
  - apply/importData/exportData now async (adapter-based)
  - Lazy adapter creation via getAdapter()
- [x] **4.3** Create `packages/cli/src/config.js` — configuration handling
  - Extracted from `src/metadata.js` + `src/filler.js`
  - clean() uses dependency injection for parseEntityScript/matchReferences
- [x] **4.4** Create `packages/cli/src/references.js` — reference extraction
  - Extracted from `src/parser.js` + `src/exclusions.js` (~565 lines)
  - All extraction, matching, exclusion, and cleanup functions
- [x] **4.5** Write unit tests — 45 passing (8 config + 21 references + 16 design)
- [x] **4.6** Verify all existing tests pass — 222 green
- [x] **4.7** Commit: `abbb7aa`

---

### Batch 5: DBML & Documentation Generation

Extract DBML logic, clean up remaining `src/` code.

- [x] **5.1** Create `packages/dbml/src/converter.js` — DBML conversion logic
  - DDL cleanup: removeCommentBlocks, removeIndexCreationStatements, normalizeComment, cleanupDDLForDBML
  - Conversion: buildTableReplacements, applyTableReplacements, buildProjectBlock, convertToDBML
  - Orchestrator: generateDBML() — takes entities, project config, DDL generator, entity filter
- [x] **5.2** Write tests — 22 passing (cleanup, replacements, conversion, generateDBML)
- [x] **5.3** Update packages/cli/src/design.js — dbml() delegates to generateDBML()
  - Removed direct @dbml/core dependency from CLI package
- [x] **5.4** Verify all tests pass — 222 existing + 45 CLI + 22 DBML all green
- [x] **5.5** Commit: `e6258ab`

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

## Current Batch: 5 COMPLETE → Next: Batch 6 (Cleanup & v2.0.0 Release Prep)

Batch 0: 136 compatibility tests in `spec/compat/` (safety net).
Batch 1: Workspace packages configured, versions at 2.0.0-alpha.0, placeholder entry points created.
Batch 2: packages/db implemented — 4 modules, 99 tests. All 222 existing tests still green.
Batch 3: PsqlAdapter (psql plugin), registerAdapter API, 29 adapter tests. All tests green.
Batch 4: packages/cli extracted — 4 modules (config, references, design, index), 45 tests. All 222 existing tests still green.
Batch 5: packages/dbml implemented — converter.js with generateDBML orchestrator, 22 tests. CLI dbml() delegates to package.
