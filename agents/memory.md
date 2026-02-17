# Project Memory

Shared project knowledge and confirmed decisions. Updated when decisions are made.
This file is read at the start of every session.

---

## Project Identity

**DBD (Database Designer)** is a CLI tool for parsing, analyzing, and working with SQL database schemas. It applies individual DDL scripts to databases, loads staging data, exports data, and generates DBML documentation.

- **Runtime:** Node.js (ES Modules)
- **Package Manager:** Bun (with pnpm lockfile)
- **Test Framework:** Vitest
- **Key Dependencies:** node-sql-parser, @dbml/core, ramda, sade, js-yaml

## Architecture

| Component           | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `packages/parser`   | SQL parsing and schema extraction (functional, AST-based) |
| `packages/cli`      | Command-line interface and orchestration                  |
| `packages/dbml`     | DBML conversion and dbdocs.io publishing                  |
| `packages/db`       | Database operations abstraction                           |
| `adapters/postgres` | PostgreSQL-specific adapter                               |
| `src/`              | Legacy monolithic source (being refactored into packages) |

### Dependency Flow

```
cli -> db -> adapters/postgres
    -> dbml -> parser
    -> parser
```

### Package Naming

- Core packages: `@jerrythomas/dbd-{name}` (parser, dbml, db)
- CLI: `@jerrythomas/dbd-cli` (publishes `dbd` binary)
- Adapters: `@jerrythomas/dbd-{database}-adapter` in `adapters/{database}/`
- Root package: `@jerrythomas/dbd` — workspace-only (private, not published)

## Key Decisions

| Decision                             | Rationale                                                                      | Date         |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------ |
| Functional programming approach      | Pure functions, composition over inheritance, predictable behavior             | Pre-existing |
| node-sql-parser for AST              | Replaced brittle regex parsing with proper AST                                 | Pre-existing |
| Workspace refactoring                | Monolith -> packages for maintainability                                       | Pre-existing |
| Vitest for testing                   | Fast, ES module native, good DX                                                | Pre-existing |
| Ramda for FP utilities               | Consistent functional toolkit                                                  | Pre-existing |
| Coexistence strategy                 | Old `src/` untouched until switchover; new code alongside, not on top          | 2026-02-17   |
| Dual binary during migration         | `dbd` (old) + `dbd-cli` (new) for side-by-side testing                         | 2026-02-17   |
| No legacy shim                       | At switchover: delete `src/` entirely, rename `dbd-cli` to `dbd`               | 2026-02-17   |
| Root becomes workspace-only          | Root `package.json` private, no bin — only for workspace mgmt                  | 2026-02-17   |
| PsqlAdapter as default plugin        | Keep existing psql shelling as default adapter; plugin system for alternatives | 2026-02-17   |
| registerAdapter() plugin API         | Custom adapters registered via `registerAdapter(type, loader)`                 | 2026-02-17   |
| Package naming: `@jerrythomas/dbd-*` | No access to `@dbd` npm scope; keep existing `@jerrythomas/dbd-{name}`         | 2026-02-17   |
| Cherry-pick from feature branch      | Reuse adapter interface, entity-processor, e2e setup; don't merge branch       | 2026-02-17   |

## Technical Notes

- Parser has three layers: SQL Parsing -> AST Extraction -> Functional API
- Each extractor has regex fallback for unsupported SQL constructs
- Schema-qualified names (e.g., `config.features`) are supported
- Tests require PostgreSQL for integration (`bun pg-test` setup/teardown)
- `bun test:nopg` runs tests without PostgreSQL dependency
- Legacy `src/` code coexists with new `packages/` during refactoring

## Coding Conventions

- ES6+ modules, `const` over `let`, no `var`
- kebab-case filenames, camelCase functions, UPPER_SNAKE_CASE constants
- `.spec.js` suffix for tests
- Pure functions preferred, side effects isolated to adapters
- Structured error objects, not thrown strings
- Graceful degradation with fallback extraction

## Current Status

- **v2.0.0 migration: COMPLETE** — all 7 stages (0–6) done
- All packages at v2.0.0: parser, db, dbml, cli, postgres-adapter
- Root package: v2.0.0, private (workspace-only)
- Legacy `src/` retained — compat tests still import from it; can be removed in a future cleanup
- Test counts: 222 legacy/compat + 99 db + 29 postgres + 45 cli + 22 dbml + 114 parser = ~530 total
- **AST-based reference extraction:** `parseEntityScript()` now uses AST parser first, regex fallback second
  - `extractDependencies()` in parser functional API — composes all extractors
  - View CTE aliases filtered from dependencies; CTE body deps included
  - Procedure/function body: AST extraction when parsed, regex fallback strips comments/strings
  - Trigger extractor: regex-based (node-sql-parser doesn't support CREATE TRIGGER)
  - Regex exclusion lists (`internals`, `isAnsiiSQL`, `isPostgres`) marked deprecated

### Package Summary

| Package             | Tests | Key Modules                                                  |
| ------------------- | ----- | ------------------------------------------------------------ |
| `packages/db`       | 99    | base-adapter, entity-processor, dependency-resolver, factory |
| `packages/cli`      | 45    | config, references, design, index (sade CLI)                 |
| `packages/dbml`     | 22    | converter (cleanup, conversion, generateDBML)                |
| `adapters/postgres` | 29    | psql-adapter (wraps execSync psql)                           |
| `packages/parser`   | 114   | SQL parsing, AST extraction, functional API, dependency extraction |

## Key Files for Resuming

| File                                    | What to read                                       |
| --------------------------------------- | -------------------------------------------------- |
| `agents/plan.md`                        | Full batch plan — all stages complete              |
| `agents/journal.md`                     | Chronological progress with commit hashes          |
| `docs/design/04-v2-architecture.md`     | Target architecture, interfaces, patterns          |
| `docs/design/05-v2-migration-stages.md` | Detailed steps for each stage                      |
| `agents/backlog.md`                     | Future work: programmatic DB adapter, src/ removal |
