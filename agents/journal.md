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

| File | Tests | Coverage |
|------|-------|----------|
| `spec/compat/design.spec.js` | 37 | Design class: init, config loading, entity discovery, dependency order, validation, combine, dbml, dry-run, bad-example errors |
| `spec/compat/references.spec.js` | 29 | Reference extraction: extractReferences, extractTableReferences, extractTriggerReferences, searchPaths, CTE aliases, parseEntityScript, matchReferences, lookup tree, DDL cleanup |
| `spec/compat/entity.spec.js` | 42 | Entity transforms: entityFromFile (all patterns), entityFrom*Config factories, ddlFromEntity (all types), validateEntityFile, importScriptForEntity, exportScriptForEntity, entitiesForDBML filtering |
| `spec/compat/config.spec.js` | 28 | Config loading: scan, read, clean, merge, organize, regroup, fillMissingInfoForEntities, dependency ordering, cycle detection |

Also:
- Added `test:compat` script to root package.json
- All 222 tests pass (86 existing + 136 compat)
- Prettier clean on all new files
