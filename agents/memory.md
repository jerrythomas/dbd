# Project Memory

Shared project knowledge and confirmed decisions. Updated when decisions are made.
This file is read at the start of every session.

---

## Project Identity

**DBD (Database Designer)** is a CLI tool for parsing, analyzing, and working with SQL database schemas. It applies individual DDL scripts to databases, loads staging data, exports data, and generates DBML documentation.

- **Runtime:** Node.js (ES Modules)
- **Package Manager:** Bun (with pnpm lockfile)
- **Test Framework:** Vitest
- **Key Dependencies:** pgsql-parser (PG C parser via WASM), @dbml/core, ramda, sade, js-yaml

## Architecture

| Component           | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `packages/cli`      | Command-line interface and orchestration (dialect-agnostic)             |
| `packages/db`       | Database abstraction, entity processing, adapter factory               |
| `packages/dbml`     | DBML conversion and dbdocs.io publishing                               |
| `packages/postgres` | PostgreSQL adapter — parse, classify, apply, import, export (owns parser) |

### Dependency Flow

```
cli -> db -> postgres (includes parser, reference-classifier, regex-fallback)
    -> dbml
```

### Package Naming

- Core packages: `@jerrythomas/dbd-{name}` (dbml, db)
- CLI: `@jerrythomas/dbd-cli` (publishes `dbd` binary)
- Adapters: `@jerrythomas/dbd-{database}-adapter` in `packages/{database}/`
- Root package: `@jerrythomas/dbd` — workspace-only (private, not published)

## Key Decisions

| Decision                             | Rationale                                                                       | Date         |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------ |
| Functional programming approach      | Pure functions, composition over inheritance, predictable behavior              | Pre-existing |
| node-sql-parser for AST              | Replaced brittle regex parsing with proper AST                                  | Pre-existing |
| Workspace refactoring                | Monolith -> packages for maintainability                                        | Pre-existing |
| Vitest for testing                   | Fast, ES module native, good DX                                                 | Pre-existing |
| Ramda for FP utilities               | Consistent functional toolkit                                                   | Pre-existing |
| Coexistence strategy                 | Old `src/` untouched until switchover; new code alongside, not on top           | 2026-02-17   |
| Dual binary during migration         | `dbd` (old) + `dbd-cli` (new) for side-by-side testing                          | 2026-02-17   |
| No legacy shim                       | At switchover: delete `src/` entirely, rename `dbd-cli` to `dbd`                | 2026-02-17   |
| Root becomes workspace-only          | Root `package.json` private, no bin — only for workspace mgmt                   | 2026-02-17   |
| PsqlAdapter as default plugin        | Keep existing psql shelling as default adapter; plugin system for alternatives  | 2026-02-17   |
| registerAdapter() plugin API         | Custom adapters registered via `registerAdapter(type, loader)`                  | 2026-02-17   |
| Package naming: `@jerrythomas/dbd-*` | No access to `@dbd` npm scope; keep existing `@jerrythomas/dbd-{name}`          | 2026-02-17   |
| Cherry-pick from feature branch      | Reuse adapter interface, entity-processor, e2e setup; don't merge branch        | 2026-02-17   |
| Delete `src/` and `spec/` (tests)    | Migration complete; all code in workspace packages; `spec/fixtures/` kept       | 2026-02-18   |
| Delete `.rules/` folder              | Superseded by `agents/` and `docs/`                                             | 2026-02-18   |
| ESLint v9 flat config                | Old `.eslintrc` deleted; `eslint.config.js` with strictness rules at warn level | 2026-02-18   |
| Switch to `pgsql-parser`             | Real PG parser (WASM); eliminates regex fallback; trigger support; round-trip   | 2026-02-18   |
| Entity classes (ParsedEntity)        | Typed classes holding structured parse results; enables diff/snapshot/DBML      | 2026-02-18   |
| DDL files as source of truth         | Entity classes are parsed representations, never authoritative                  | 2026-02-18   |
| Snapshots in project folder          | `snapshots/{version}.json`; sequential integer versioning                       | 2026-02-18   |
| Migrations from snapshot diffs       | `migrations/{from}-to-{to}.sql`; `_dbd_migrations` table for version tracking   | 2026-02-18   |
| Parser moved into postgres adapter   | Parser is 100% PG-specific; adapter owns parse+classify+apply+import+export     | 2026-02-18   |
| CLI is dialect-agnostic              | `using()` async factory; config `project.database` drives adapter selection     | 2026-02-18   |
| `packages/parser` deleted            | Re-export shim removed; all parser code in `packages/postgres/src/parser/`      | 2026-02-18   |

## Technical Notes

- Parser has three layers: SQL Parsing -> AST Extraction -> Functional API
- Each extractor has regex fallback for unsupported SQL constructs (to be removed after pgsql-parser switch)
- Schema-qualified names (e.g., `config.features`) are supported
- Tests require PostgreSQL for integration (`bun pg-test` setup/teardown)
- `bun test:nopg` runs tests without PostgreSQL dependency
- Legacy `src/` and `spec/` (tests) deleted; `spec/fixtures/` kept for shared test data

## Coding Conventions

- ES6+ modules, `const` over `let`, no `var`
- kebab-case filenames, camelCase functions, UPPER_SNAKE_CASE constants
- `.spec.js` suffix for tests
- Pure functions preferred, side effects isolated to adapters
- Structured error objects, not thrown strings
- Graceful degradation with fallback extraction

## Current Status

- **v2.0.0 migration: COMPLETE** — legacy `src/` and `spec/` deleted, all code in workspace packages
- All packages at v2.0.0: db, dbml, cli, postgres-adapter
- Parser moved into postgres adapter (parser package deleted)
- CLI is fully dialect-agnostic — `using()` is async, adapter drives parsing
- Root package: v2.0.0, private (workspace-only)
- Test counts: 228 postgres + 104 db + 57 cli + 35 dbml = 432 workspace tests
- Lint: 0 errors (prettier clean, ESLint config issue pre-existing)
- **Next phase:** Entity classes → Snapshots → Migrations

### Package Summary

| Package             | Tests | Key Modules                                                                  |
| ------------------- | ----- | ---------------------------------------------------------------------------- |
| `packages/postgres` | 228   | psql-adapter (parse, classify, apply), parser/, reference-classifier, regex-fallback, scripts |
| `packages/db`       | 104   | base-adapter, entity-processor, dependency-resolver, factory                 |
| `packages/cli`      | 57    | config, references (dialect-agnostic), design (async using()), db-cache      |
| `packages/dbml`     | 35    | converter (cleanup, conversion, generateDBML)                                |

## Key Files for Resuming

| File                                     | What to read                                       |
| ---------------------------------------- | -------------------------------------------------- |
| `agents/plan.md`                         | Active plan (check for current work)               |
| `agents/journal.md`                      | Chronological progress with commit hashes          |
| `docs/design/04-v2-architecture.md`      | Current architecture + roadmap                     |
| `docs/design/06-entity-classes.md`       | Entity class design (Objective 1)                  |
| `docs/design/07-snapshots-migrations.md` | Snapshots and migrations design (Objectives 2 & 3) |
| `docs/design/08-parser-switch.md`        | Parser switch plan (prerequisite)                  |
| `agents/backlog.md`                      | Deferred items                                     |
