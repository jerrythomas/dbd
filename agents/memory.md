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
- Core packages: `@dbd/{name}` (parser, dbml, db)
- CLI: `dbd` (no namespace, provides the binary)
- Adapters: `@dbd/db-{database}` in `adapters/{database}/`

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Functional programming approach | Pure functions, composition over inheritance, predictable behavior | Pre-existing |
| node-sql-parser for AST | Replaced brittle regex parsing with proper AST | Pre-existing |
| Workspace refactoring | Monolith -> packages for maintainability | Pre-existing |
| Vitest for testing | Fast, ES module native, good DX | Pre-existing |
| Ramda for FP utilities | Consistent functional toolkit | Pre-existing |

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

- Parser package: Complete with full test coverage
- Workspace refactoring: Phase 1 (Infrastructure Setup) in progress
- Legacy `src/` still active alongside new packages
