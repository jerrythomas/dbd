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
    workflow.md                  <-- Methodology and session lifecycle (READ FIRST)
    memory.md                   <-- Shared project knowledge
    journal.md                  <-- Chronological progress log
    plan.md                     <-- Active plan/checklist
    open-questions.md           <-- Q&A tracking for design discussions
    design-patterns.md          <-- Established patterns cookbook
    backlog.md                  <-- Deferred items for future phases
    sessions/                   <-- Archived completed plans
  docs/
    requirements/               <-- Feature requirements (the "what")
    design/                     <-- Module design documents (the "how")
    pre-requisites.md           <-- Setup instructions
    to-do.md                    <-- Legacy todo (parser improvements)
  packages/
    parser/                     <-- @dbd/parser — SQL parsing & schema extraction
    cli/                        <-- dbd — Command-line interface
    dbml/                       <-- @dbd/dbml — DBML conversion
    db/                         <-- @dbd/db — Database abstraction
  adapters/
    postgres/                   <-- @dbd/db-postgres — PostgreSQL adapter
  src/                          <-- Legacy monolithic source (being refactored)
  spec/                         <-- Legacy test suite
  example/                      <-- Example project structure
```

## Key Design Principles

- **Functional Programming** — pure functions, composition over inheritance, Ramda for FP utilities
- **AST-First Parsing** — `node-sql-parser` for proper AST, regex fallback for unsupported SQL
- **Graceful Degradation** — always return partial results, collect errors don't throw them
- **Separation of Concerns** — parser, CLI, adapters, and DBML are independent packages

## Commands

```bash
# Root-level tests (legacy + integration, requires PostgreSQL)
bun test                          # Full suite (pg setup, vitest, pg teardown)
bun test:unit                     # Unit tests only (vitest)
bun test:nopg                     # Tests without PostgreSQL dependency

# Workspace package tests
bun test:parser                   # packages/parser tests
bun test:cli                      # packages/cli tests
bun test:workspaces               # All workspace tests

# Code quality
bun run lint                      # prettier + eslint (0 errors expected)
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
3. **Read `.rules/architecture.md`** — the existing architecture documentation (retained for reference)
4. **Write design docs** as numbered files (`01-parser.md`, `02-cli.md`, etc.)
5. **Include**: module boundaries, data flow, key functions, error handling approach
6. **Include diagrams** where helpful (text-based: mermaid or ascii)
7. **Flag technical debt** — where implementation diverges from ideal design

### Documentation is not a prerequisite for work

- You don't need to derive all docs before starting a task
- Derive docs incrementally: document a module when you need to understand or change it
- Keep docs honest — if the code disagrees with the doc, the code wins

## Key Files Quick Reference

| File                        | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `agents/workflow.md`        | Methodology and session lifecycle                                 |
| `agents/memory.md`          | Shared project knowledge                                          |
| `agents/plan.md`            | Active plan/checklist                                             |
| `agents/journal.md`         | Chronological progress log                                        |
| `agents/backlog.md`         | Deferred items for future phases                                  |
| `agents/design-patterns.md` | Established patterns cookbook                                     |
| `packages/parser/src/`      | SQL parsing — the most mature package                             |
| `src/collect.js`            | Legacy: design class orchestration                                |
| `src/entity.js`             | Legacy: DDL execution (to be split into cli + adapter)            |
| `.rules/`                   | Legacy guidelines (retained for reference, superseded by agents/) |
