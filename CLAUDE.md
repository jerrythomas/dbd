# DBD — Agent Instructions

This file is the entry point for any AI agent working on this repo.

## MANDATORY: Load Workflow First

Before doing any work, read these files in order:

1. **`agents/workflow.md`** — methodology, session lifecycle, question protocol
2. **`agents/memory.md`** — shared project knowledge and decisions
3. **`agents/journal.md`** (last ~50 lines) — recent progress
4. **`agents/plan.md`** — check for active plan to resume
5. **`agents/design-patterns.md`** — established patterns to follow

These files govern how you work. Do not skip them.

---

## Project Overview

**DBD (Database Designer)** is a CLI tool for parsing, analyzing, and working with SQL database schemas. It applies individual DDL scripts to databases, loads staging data, exports data, and generates DBML documentation for [dbdocs.io](https://dbdocs.io).

## Repository Structure

```
dbd/
  CLAUDE.md                      <-- You are here
  agents/                        <-- Agent workflow, memory, journal, plans
  docs/
    requirements/               <-- Feature requirements (the "what")
    design/                     <-- Module design documents (the "how")
  solution/                      <-- Monorepo workspace root
    package.json                <-- Workspace config, scripts, devDependencies
    vitest.config.ts            <-- Single vitest config (all projects)
    eslint.config.js            <-- ESLint flat config
    .prettierrc                 <-- Prettier config
    packages/
      parser/                   <-- @dbd/parser — SQL parsing & schema extraction
      cli/                      <-- dbd — CLI, config, design orchestrator, references
      dbml/                     <-- @dbd/dbml — DBML conversion
      db/                       <-- @dbd/db — Database abstraction, entity processing
      postgres/                 <-- @dbd/db-postgres — PostgreSQL adapter
    example/                    <-- Example project structure
```

## Key Design Principles

- **Functional Programming** — pure functions, composition over inheritance, Ramda for FP utilities
- **AST-First Parsing** — `pgsql-parser` (PostgreSQL C parser via WASM) for accurate AST, regex fallback for unsupported SQL
- **Graceful Degradation** — always return partial results, collect errors don't throw them
- **Separation of Concerns** — parser, CLI, adapters, and DBML are independent packages

## Commands

All workspace commands run from `solution/`:

```bash
# All tests (workspace-aware vitest)
cd solution
bun run test                      # All workspace tests (vitest run)
bun run test:watch                # Watch mode

# Individual package tests (via --project)
bun run test:parser               # packages/parser tests (115 tests)
bun run test:cli                  # packages/cli tests (55 tests)
bun run test:db                   # packages/db tests (99 tests)
bun run test:dbml                 # packages/dbml tests (35 tests)
bun run test:postgres             # packages/postgres tests (29 tests)

# Coverage
bun run coverage                  # All packages coverage report

# E2E tests (requires PostgreSQL via Docker)
bun run test:e2e                  # packages/cli e2e tests
bun run test:pg                   # Full suite (pg setup, e2e, pg teardown)

# Code quality
bun run lint                      # prettier + eslint
bun run format                    # Auto-format with prettier
```

## Conventions

### Design before implementation

For non-trivial work: ask questions, agree on approach with examples, then implement.
See `agents/workflow.md` for the full process.

### When a feature design is agreed upon

1. Update the relevant `docs/design/*.md` module file
2. Log in `agents/journal.md`
3. Create plan in `agents/plan.md`

### When completing work

1. Run tests and lint — both must pass
2. Update `agents/plan.md` — mark steps complete
3. Update `agents/journal.md` — log what was done with commit hashes
4. On plan completion: archive to `agents/sessions/YYYY-MM-DD-<name>.md`

### Code style

- ES6+ modules, `const` over `let`, no `var`
- kebab-case filenames, camelCase functions, UPPER_SNAKE_CASE constants
- `.spec.js` for tests, Arrange-Act-Assert pattern
- Conventional commits: `feat(parser):`, `fix(cli):`, `docs:`, `test:`, `chore:`

### Lint Rules

- Warnings are pre-existing and acceptable
- **Errors must be zero**

## Brownfield Project: Deriving Documentation

This is an existing codebase. Requirements and design documents should be **derived from the code**, not invented from scratch.

### Deriving `docs/requirements/`

Requirements capture the "what" — extract them from existing behavior:

1. **Read the code** — understand what each module actually does today
2. **Read the tests** — tests are the most reliable spec of current behavior
3. **Read README.md** — the feature checklist shows intended capabilities
4. **Read example/** — shows the expected folder structure and usage patterns
5. **Write requirements** as numbered files (`01-parser.md`, `02-cli.md`, etc.)
6. **Focus on observable behavior** — what the user/caller can do, not implementation details
7. **Mark gaps** — where behavior exists in code but has no test, note it as "untested"

### Deriving `docs/design/`

Design documents capture the "how" — extract them from implementation:

1. **Read the source** — trace data flow through each module
2. **Read `agents/design-patterns.md`** — established patterns are already documented
3. **Write design docs** as numbered files (`01-parser.md`, `02-cli.md`, etc.)
4. **Include**: module boundaries, data flow, key functions, error handling approach
5. **Include diagrams** where helpful (text-based: mermaid or ascii)
6. **Flag technical debt** — where implementation diverges from ideal design

### Documentation is not a prerequisite for work

- You don't need to derive all docs before starting a task
- Derive docs incrementally: document a module when you need to understand or change it
- Keep docs honest — if the code disagrees with the doc, the code wins

## Key Files Quick Reference

| File                                      | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `agents/workflow.md`                      | Methodology and session lifecycle               |
| `agents/memory.md`                        | Shared project knowledge                        |
| `agents/plan.md`                          | Active plan/checklist                           |
| `agents/journal.md`                       | Chronological progress log                      |
| `agents/backlog.md`                       | Deferred items for future phases                |
| `agents/design-patterns.md`              | Established patterns cookbook                    |
| `solution/vitest.config.ts`              | Single vitest config for all projects           |
| `solution/packages/parser/src/`          | SQL parsing & schema extraction                 |
| `solution/packages/cli/src/design.js`    | Design class — main orchestrator                |
| `solution/packages/cli/src/config.js`    | YAML config loading & entity discovery          |
| `solution/packages/cli/src/references.js`| AST-based reference extraction & exclusions     |
| `solution/packages/cli/src/index.js`     | CLI entry point (sade commands)                 |
| `solution/packages/db/src/`              | Entity processing, dependency resolver, adapter |
| `solution/packages/dbml/src/`            | DBML generation from DDL entities               |
| `solution/packages/postgres/src/`        | PostgreSQL adapter implementation               |
