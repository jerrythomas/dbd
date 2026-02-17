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
