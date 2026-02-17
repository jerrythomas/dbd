# Backlog

Deferred items and future phase details for the v2.0.0 migration.

---

## 1. Multi-Database Support (Post v2.0.0)

**Source:** README.md roadmap item

### What exists

- Adapter pattern established in Batch 2-3 of v2.0.0 plan
- PostgreSQL adapter as reference implementation

### What's needed

- [ ] MySQL adapter (`@dbd/db-mysql`) in `adapters/mysql/`
- [ ] MSSQL adapter (`@dbd/db-mssql`) in `adapters/mssql/`
- [ ] SQLite adapter for local dev/testing
- [ ] Adapter auto-detection from connection string

---

## 2. Same-Name Tables Across Schemas (Post v2.0.0)

**Source:** README.md roadmap item

### What exists

- Schema-qualified names supported in parser
- Single-schema name uniqueness assumed in dependency resolution

### What's needed

- [ ] Update dependency-resolver to use fully-qualified names as keys
- [ ] Update reference matching to always use schema.name
- [ ] Test with multiple schemas having identically-named tables

---

## 3. DB Library Evaluation (Batch 3 prerequisite)

**Purpose:** Choose the programmatic PostgreSQL library to replace `psql` CLI shelling.

### Candidates

| Library                  | Pros                                                         | Cons                                                 |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| `@databases/pg`          | Already used in feature branch, SQL injection safe, good API | Less popular, COPY support unclear                   |
| `postgres.js` (porsager) | Fastest, Bun/Deno/CF support, tagged templates, active       | COPY via `sql.copy()` — need to verify streaming CSV |
| `pg` + `pg-copy-streams` | Most popular, battle-tested, proven COPY streaming           | Two packages, older callback API                     |

### Decision criteria

- COPY FROM support for CSV streaming (critical for import)
- COPY TO support for export
- Transaction API
- Connection pooling
- Bun compatibility
- Maintenance activity

### Decision

To be made at start of Batch 3. Document in `agents/memory.md`.

---

## 4. Feature Branch Cherry-Pick Inventory

**Source:** `feature/monorepo-refactor` (10 commits, 22K lines)

### Reusable components (cherry-pick or adapt)

- [ ] `packages/db/src/base-adapter.js` — adapter interface (292 lines, well-documented)
- [ ] `packages/db/src/entity-processor.js` — entity filtering + script combination
- [ ] `packages/db/src/schema-transformer.js` — DDL transformation with AST
- [ ] `packages/db/src/dependency-processor.js` — topological sort with cycle detection
- [ ] `adapters/postgres/src/adapter.js` — PostgreSQLAdapter class
- [ ] `adapters/postgres/src/connection.js` — dual execution (psql + @databases/pg)
- [ ] `adapters/postgres/e2e/` — Docker-based e2e test setup
- [ ] `packages/parser/src/entity-analyzer.js` — entity metadata analysis (672 lines)
- [ ] ESLint flat config (`eslint.config.mjs`)

### Not reusable (diverged too much or incomplete)

- CLI package (too tightly coupled to unfinished DB package)
- Root package.json scripts (need to rebuild for current state)
- .rules/ restructuring (superseded by agents/ workflow)
- docs/ rewrites (superseded by our derived docs)

---

## 5. Parser Enhancements (Ongoing)

**Source:** `docs/to-do.md`, known limitations in `docs/requirements/01-parser.md`

### What's needed

- [ ] Window function handling in view extraction
- [ ] Recursive CTE tracking in view dependencies
- [ ] Materialized view distinction
- [ ] Table-level constraint name extraction
- [ ] COMMENT ON FUNCTION/VIEW support
- [ ] Partition directive capture

---

## 6. DBML/dbdocs Integration Improvements (Post v2.0.0)

### What exists

- `@dbml/core` importer for SQL → DBML conversion
- `dbdocs` CLI for publishing

### What's needed

- [ ] Investigate `dbdocs` programmatic API (none found — may need to keep CLI)
- [ ] Include view definitions in DBML output if possible
- [ ] Include index definitions (currently stripped due to importer limitation)
- [ ] Consider generating DBML directly from parsed schema (bypass SQL → DBML importer)

---

## 7. Migration & Seeding Improvements (Post v2.0.0)

### What exists

- CSV/JSON import via `\copy` through psql
- Post-import procedure execution via `loader.sql`
- Staging schema restriction

### What's explored

- `pg-copy-streams` — proven streaming COPY for Node.js
- `postgres.js` — modern alternative with built-in COPY
- Programmatic approach eliminates `psql` CLI dependency

### What's needed

- [ ] Migration versioning (track which migrations have been applied)
- [ ] Rollback support for failed migrations
- [ ] Diff-based schema migration (current state vs desired state)
- [ ] Seed data versioning
