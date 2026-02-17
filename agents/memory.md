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

| Component | Purpose |
|-----------|---------|
| `packages/parser` | SQL parsing and schema extraction (functional, AST-based) |
| `packages/cli` | Command-line interface and orchestration |
| `packages/dbml` | DBML conversion and dbdocs.io publishing |
| `packages/db` | Database operations abstraction |
| `adapters/postgres` | PostgreSQL-specific adapter |
| `src/` | Legacy monolithic source (being refactored into packages) |

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

| Decision | Rationale | Date |
|----------|-----------|------|
| Functional programming approach | Pure functions, composition over inheritance, predictable behavior | Pre-existing |
| node-sql-parser for AST | Replaced brittle regex parsing with proper AST | Pre-existing |
| Workspace refactoring | Monolith -> packages for maintainability | Pre-existing |
| Vitest for testing | Fast, ES module native, good DX | Pre-existing |
| Ramda for FP utilities | Consistent functional toolkit | Pre-existing |
| Coexistence strategy | Old `src/` untouched until switchover; new code alongside, not on top | 2026-02-17 |
| Dual binary during migration | `dbd` (old) + `dbd-cli` (new) for side-by-side testing | 2026-02-17 |
| No legacy shim | At switchover: delete `src/` entirely, rename `dbd-cli` to `dbd` | 2026-02-17 |
| Root becomes workspace-only | Root `package.json` private, no bin — only for workspace mgmt | 2026-02-17 |
| Replace psql with programmatic DB | Adapter uses pg library directly — no shelling to psql | 2026-02-17 |
| DB library TBD | Choose between pg+pg-copy-streams, postgres.js, @databases/pg at Stage 3 | 2026-02-17 |
| Package naming: `@jerrythomas/dbd-*` | No access to `@dbd` npm scope; keep existing `@jerrythomas/dbd-{name}` | 2026-02-17 |
| Cherry-pick from feature branch | Reuse adapter interface, entity-processor, e2e setup; don't merge branch | 2026-02-17 |

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

- **v2.0.0 migration:** Stage 0 complete (136 compat tests), Stage 1 next
- Parser package: Complete with full test coverage
- Legacy `src/` active — untouched until Stage 5 switchover
- Design docs complete: `docs/design/04-v2-architecture.md`, `docs/design/05-v2-migration-stages.md`
- Plan: `agents/plan.md` has full 7-stage batch plan

## Key Files for Resuming

| File | What to read |
|------|-------------|
| `agents/plan.md` | Current batch plan — Stage 0 is next |
| `docs/design/04-v2-architecture.md` | Target architecture, interfaces, patterns |
| `docs/design/05-v2-migration-stages.md` | Detailed steps for each stage |
| `agents/backlog.md` | Cherry-pick inventory, DB library evaluation, future work |
