# Repo Restructure: Move solution/ to Root Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the monorepo workspace from `solution/` to the repo root, consolidate tool configs into `config/`, update all scripts and workflows, and verify everything works.

**Architecture:** Use `git mv` to preserve history. Move in this order: packages → example → package.json/bun.lock → tool configs → update scripts/configs → reinstall → verify. Never leave the repo in a broken state between commits.

**Tech Stack:** Bun, Vitest, ESLint, Prettier, bumpp, GitHub Actions

---

## Chunk 1: Baseline + Move Files

### Task 1: Record baseline

**Files:** none modified

- [ ] **Step 1: Run full test suite from current location**

```bash
cd /Users/Jerry/Developer/dbd/solution
bun run test
```

Expected: `684 passed` (or current count). Record the number.

- [ ] **Step 2: Run lint baseline**

```bash
cd /Users/Jerry/Developer/dbd/solution
bun run lint 2>&1 | tail -3
```

Expected: warnings only from `coverage/` and `bumpp.config.js` — zero new errors.

---

### Task 2: Move packages/, example/, package.json, bun.lock to root

**Files:**

- Move: `solution/packages/` → `packages/`
- Move: `solution/example/` → `example/`
- Move: `solution/package.json` → `package.json`
- Move: `solution/bun.lock` → `bun.lock`
- Delete: `solution/node_modules/`, `solution/coverage/`, `solution/.DS_Store`

- [ ] **Step 1: Move packages and example**

```bash
cd /Users/Jerry/Developer/dbd
git mv solution/packages packages
git mv solution/example example
```

- [ ] **Step 2: Move workspace root files**

```bash
cd /Users/Jerry/Developer/dbd
git mv solution/package.json package.json
git mv solution/bun.lock bun.lock
```

- [ ] **Step 3: Remove gitignored solution/ artifacts**

```bash
cd /Users/Jerry/Developer/dbd
rm -rf solution/node_modules solution/coverage solution/.DS_Store
```

- [ ] **Step 4: Verify solution/ is now empty (or nearly empty)**

```bash
ls -la /Users/Jerry/Developer/dbd/solution/
```

Expected: only the tool config files remain (`.prettierrc`, `.prettierignore`, `eslint.config.js`, `vitest.config.ts`, `bumpp.config.js`).

---

### Task 3: Create config/ and move tool configs

**Files:**

- Create: `config/` directory
- Move: `solution/eslint.config.js` → `config/eslint.config.js`
- Move: `solution/vitest.config.ts` → `config/vitest.config.ts`
- Move: `solution/bumpp.config.js` → `config/bumpp.config.js`
- Move: `solution/.prettierrc` → `config/.prettierrc`
- Move: `solution/.prettierignore` → `config/.prettierignore`

- [ ] **Step 1: Create config/ and move all tool configs**

```bash
cd /Users/Jerry/Developer/dbd
mkdir config
git mv solution/eslint.config.js config/eslint.config.js
git mv solution/vitest.config.ts config/vitest.config.ts
git mv solution/bumpp.config.js config/bumpp.config.js
git mv solution/.prettierrc config/.prettierrc
git mv solution/.prettierignore config/.prettierignore
```

- [ ] **Step 2: Confirm solution/ is now empty and remove it**

```bash
ls /Users/Jerry/Developer/dbd/solution/
rmdir /Users/Jerry/Developer/dbd/solution
git rm -r --cached solution 2>/dev/null || true
```

Expected: `solution/` is gone.

- [ ] **Step 3: Commit the file moves**

```bash
cd /Users/Jerry/Developer/dbd
git add -A
git status
git commit -m "chore: move solution/ contents to repo root, create config/ for tool configs"
```

---

## Chunk 2: Update Config Files

### Task 4: Update vitest.config.ts for new location

`vitest.config.ts` is now in `config/`. It must anchor all paths to the repo root (one level up) using `__dirname`.

**Files:**

- Modify: `config/vitest.config.ts`

- [ ] **Step 1: Rewrite vitest.config.ts**

Replace the entire contents of `config/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

export default defineConfig({
  test: {
    root,
    pool: 'forks',
    globals: true,
    include: ['spec/**/*.spec.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.js'],
      exclude: ['packages/cli/src/index.js', 'packages/postgres/src/parser/parse-ddl.js'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'postgres',
          root: resolve(__dirname, '../packages/postgres'),
          setupFiles: ['spec/parser/setup.js']
        }
      },
      { extends: true, test: { name: 'cli', root: resolve(__dirname, '../packages/cli') } },
      { extends: true, test: { name: 'db', root: resolve(__dirname, '../packages/db') } },
      { extends: true, test: { name: 'dbml', root: resolve(__dirname, '../packages/dbml') } }
    ]
  }
})
```

- [ ] **Step 2: Update .prettierignore to cover coverage/ and config/**

Replace the entire contents of `config/.prettierignore`:

```
.svelte-kit/**
static/**
build/**
node_modules/**
coverage/**
```

- [ ] **Step 3: Commit config file updates**

```bash
cd /Users/Jerry/Developer/dbd
git add config/vitest.config.ts config/.prettierignore
git commit -m "chore(config): update vitest.config.ts to resolve paths from repo root"
```

---

## Chunk 3: Update package.json Scripts

### Task 5: Add --config flags to all scripts

Every tool script must now explicitly reference configs in `config/`.

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Replace the scripts block in package.json**

Update `package.json` `"scripts"` section to:

```json
"scripts": {
  "test": "vitest run --config config/vitest.config.ts",
  "test:watch": "vitest --config config/vitest.config.ts",
  "test:parser": "vitest run --config config/vitest.config.ts --project postgres",
  "test:cli": "vitest run --config config/vitest.config.ts --project cli",
  "test:db": "vitest run --config config/vitest.config.ts --project db",
  "test:dbml": "vitest run --config config/vitest.config.ts --project dbml",
  "test:postgres": "vitest run --config config/vitest.config.ts --project postgres",
  "test:unit": "vitest run --config config/vitest.config.ts",
  "test:nopg": "vitest run --config config/vitest.config.ts",
  "coverage": "vitest run --config config/vitest.config.ts --coverage",
  "test:e2e": "vitest run --config packages/cli/vitest.e2e.config.js",
  "pg-test": "docker run --name pg-test -p 5234:5432 -e POSTGRES_PASSWORD=pg-test -d postgres",
  "test:pg": "bun pg-test && bun test:e2e && bun test:clean",
  "test:clean": "docker stop pg-test && docker rm pg-test",
  "lint": "prettier --config config/.prettierrc --ignore-path config/.prettierignore --check . && eslint --config config/eslint.config.js .",
  "format": "prettier --config config/.prettierrc --ignore-path config/.prettierignore --write .",
  "bump": "bumpp --config config/bumpp.config.js",
  "bump:next": "bumpp --config config/bumpp.config.js --preid=next",
  "publish:all": "find ./packages -type d -depth 1 -exec sh -c 'cd \"{}\" && bun publish' \\;",
  "release": "bun run publish:all"
}
```

- [ ] **Step 2: Commit package.json scripts**

```bash
cd /Users/Jerry/Developer/dbd
git add package.json
git commit -m "chore: update scripts to reference config/ for all tool configs"
```

---

## Chunk 4: Install + Full Verification

### Task 6: Reinstall and verify all tests and lint

**Files:** none

- [ ] **Step 1: Install dependencies at repo root**

```bash
cd /Users/Jerry/Developer/dbd
bun install
```

Expected: lockfile updated, `node_modules/` created at repo root, all workspace packages linked.

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/Jerry/Developer/dbd
bun run test
```

Expected: same pass count as baseline (684+). Zero failures.

- [ ] **Step 3: Run each package test individually**

```bash
cd /Users/Jerry/Developer/dbd
bun run test:db
bun run test:cli
bun run test:dbml
bun run test:postgres
```

Expected: all pass.

- [ ] **Step 4: Run coverage to verify paths are correct**

```bash
cd /Users/Jerry/Developer/dbd
bun run coverage 2>&1 | tail -20
```

Expected: coverage report generated, paths show `packages/*/src/**` (not `config/packages/...`). Thresholds should pass.

- [ ] **Step 5: Run lint — check for unnecessary files being flagged**

```bash
cd /Users/Jerry/Developer/dbd
bun run lint 2>&1
```

Expected:

- `prettier` warns only about files that were already pre-existing issues (none of our changed files)
- `eslint` zero errors
- `coverage/**` is NOT flagged (covered by `.prettierignore`)
- `config/` files are NOT double-checked with wrong paths

If prettier flags unexpected files, add them to `config/.prettierignore`.

- [ ] **Step 6: Run format to confirm no regressions**

```bash
cd /Users/Jerry/Developer/dbd
bun run format 2>&1 | tail -5
```

Expected: formats only files that need it; no errors.

- [ ] **Step 7: Verify lint on only our changed source files**

```bash
cd /Users/Jerry/Developer/dbd
bunx eslint --config config/eslint.config.js packages/db/src/dependency-resolver.js packages/cli/src/design.js packages/cli/src/index.js 2>&1
```

Expected: no errors (warnings are pre-existing and acceptable).

- [ ] **Step 8: Commit**

```bash
cd /Users/Jerry/Developer/dbd
git add bun.lock
git commit -m "chore: reinstall dependencies at repo root after restructure"
```

---

## Chunk 5: Update Workflows, .gitignore, README, CLAUDE.md

### Task 7: Update .github/workflows/publish.yml

**Files:**

- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Fix publish.yml**

Replace entire contents of `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: bun install

      - name: Publish packages
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          for dir in ./packages/*/; do
            grep -q '"private": true' "${dir}package.json" 2>/dev/null || \
              (cd "$dir" && npm publish --provenance --access public)
          done

      - name: Create GitHub release
        run: npx changelogithub
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Key change: `./packages/*/ ./adapters/*/` → `./packages/*/` (no more `adapters/`; packages are at root).

- [ ] **Step 2: Update coverage.yml**

`coverage.yml` already runs from repo root — no `cd solution` needed. Verify it's clean:

```bash
cat /Users/Jerry/Developer/dbd/.github/workflows/coverage.yml
```

The `bun install --frozen-lockfile` and `bun coverage` commands will now correctly find `package.json` and the lockfile at root. No changes needed unless you see `cd solution` — if so, remove it.

- [ ] **Step 3: Commit workflow update**

```bash
cd /Users/Jerry/Developer/dbd
git add .github/workflows/publish.yml
git commit -m "chore(ci): update publish.yml to reference packages/ at repo root"
```

---

### Task 8: Update .gitignore

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add coverage/ to .gitignore**

The current `.gitignore` at repo root doesn't include `coverage/`. After the move, `coverage/` will be generated at repo root.

Replace entire contents of `.gitignore`:

```
node_modules
coverage
.DS_Store
*.log
_*.sql
init.sql
original
```

- [ ] **Step 2: Commit**

```bash
cd /Users/Jerry/Developer/dbd
git add .gitignore
git commit -m "chore: add coverage/ to .gitignore at repo root"
```

---

### Task 9: Update README.md

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README.md**

Replace the entire `README.md`:

```markdown
# dbd

[![Maintainability](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/maintainability)](https://codeclimate.com/github/jerrythomas/dbd/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/test_coverage)](https://codeclimate.com/github/jerrythomas/dbd/test_coverage)

A CLI tool for managing SQL database schemas. Apply individual DDL scripts to databases, load staging data, export data, and generate DBML documentation for [dbdocs.io](https://dbdocs.io).

- [x] Apply a set of individual DDL scripts to a database
- [x] Load staging data with post-process scripts for development/testing
- [x] Export data from tables & views
- [x] Generate [dbdocs](https://dbdocs.io) DBML for all (or subset) tables
- [x] Support for multiple schemas where names are unique across all schemas
- [x] Parse files and identify dependencies (e.g. views depend on tables)
- [x] Combine all scripts into a single file for deployment
- [x] Output dependency graph as JSON for tooling and LLM consumption
- [ ] Support for multiple databases (e.g. postgres, mysql, mssql)

## Architecture

DBD is organized as a monorepo with focused packages:
```

packages/
cli/ @jerrythomas/dbd — CLI, config, design orchestrator
db/ @jerrythomas/dbd-db — Database operations abstraction
dbml/ @jerrythomas/dbd-dbml — DBML conversion & documentation
postgres/ @jerrythomas/dbd-postgres-adapter — PostgreSQL adapter (parser + psql)

```

### Dependency Flow

```

dbd (cli) -> dbd-db -> dbd-postgres-adapter
-> dbd-dbml

````

## [Pre-requisites](docs/pre-requisites.md)

Refer to the pre-requisites document for setting up the dbd cli.

## Usage

Install the CLI globally using npm (or pnpm/yarn):

```bash
npm i --global @jerrythomas/dbd
````

### Folder Structure

Individual DDL scripts are expected to be placed under folders with names of the database object types. Subfolders are used to specify the schema names. Files are expected to have the same name as the object.

[example](example)

> Note: The CLI relies on dependencies mentioned in a YAML file (`design.yaml`) to execute scripts in sequence. Refer to the example folder.

### Commands

| Command     | Action                          |
| ----------- | ------------------------------- |
| dbd init    | Create an example repo          |
| dbd inspect | Inspect and report issues       |
| dbd combine | Combine all into single script  |
| dbd apply   | Apply the creation scripts      |
| dbd import  | Load seed/staging files         |
| dbd export  | Export tables/views             |
| dbd dbml    | Generate DBML files             |
| dbd graph   | Output dependency graph as JSON |

## Development

```bash
# Install dependencies
bun install

# Run all unit tests
bun run test

# Run specific package tests
bun run test:cli
bun run test:db
bun run test:dbml
bun run test:postgres

# Coverage
bun run coverage

# Format and lint
bun run format
bun run lint
```

## Packages

| Package                                                | Description                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| [@jerrythomas/dbd](packages/cli)                       | CLI commands, configuration loading, Design class orchestration        |
| [@jerrythomas/dbd-db](packages/db)                     | Database adapter abstraction, entity processing, dependency resolution |
| [@jerrythomas/dbd-dbml](packages/dbml)                 | DBML conversion via @dbml/core with schema qualification               |
| [@jerrythomas/dbd-postgres-adapter](packages/postgres) | PostgreSQL adapter with SQL parser and reference classifier            |

## LLM Documentation

Task-oriented docs for use with AI tools are in [`docs/llms/`](docs/llms/). Covers usage patterns, config reference, DDL patterns, commands, import/export, and the dependency graph API.

````

- [ ] **Step 2: Commit README**

```bash
cd /Users/Jerry/Developer/dbd
git add README.md
git commit -m "docs: update README for repo restructure — remove solution/, add graph command and llms link"
````

---

### Task 10: Update CLAUDE.md paths

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md — replace all solution/ path references**

In `CLAUDE.md`:

1. Update the Repository Structure section — remove `solution/` wrapper:

```markdown
## Repository Structure
```

dbd/
CLAUDE.md <-- You are here
agents/ <-- Agent workflow, memory, journal, plans
config/ <-- Tool configs (eslint, prettier, vitest, bumpp)
docs/
requirements/ <-- Feature requirements (the "what")
design/ <-- Module design documents (the "how")
llms/ <-- LLM-optimised usage documentation
packages/
cli/ <-- dbd — CLI, config, design orchestrator (dialect-agnostic)
dbml/ <-- @dbd/dbml — DBML conversion
db/ <-- @dbd/db — Database abstraction, entity processing, adapter factory
postgres/ <-- @dbd/db-postgres — PostgreSQL adapter (includes parser + reference classifier)
example/ <-- Example project structure

```

```

2. Update the Commands section — remove `cd solution`:

````markdown
## Commands

All workspace commands run from repo root:

```bash
# All tests (workspace-aware vitest)
bun run test                      # All workspace tests (vitest run)
bun run test:watch                # Watch mode

# Individual package tests (via --project)
bun run test:parser               # Parser tests (runs via postgres project)
bun run test:cli                  # packages/cli tests
bun run test:db                   # packages/db tests
bun run test:dbml                 # packages/dbml tests
bun run test:postgres             # packages/postgres tests (includes parser + adapter)

# Coverage
bun run coverage                  # All packages coverage report

# E2E tests (requires PostgreSQL via Docker)
bun run test:e2e                  # packages/cli e2e tests
bun run test:pg                   # Full suite (pg setup, e2e, pg teardown)

# Code quality
bun run lint                      # prettier + eslint
bun run format                    # Auto-format with prettier
```
````

````

3. Update the Key Files Quick Reference table — remove `solution/` prefix from all paths:

| File | Purpose |
|------|---------|
| `agents/workflow.md` | Methodology and session lifecycle |
| `agents/memory.md` | Shared project knowledge |
| `agents/plan.md` | Active plan/checklist |
| `agents/journal.md` | Chronological progress log |
| `agents/backlog.md` | Deferred items for future phases |
| `agents/design-patterns.md` | Established patterns cookbook |
| `package.json` | Workspace config, scripts, devDependencies |
| `config/vitest.config.ts` | Single vitest config (all projects) |
| `config/eslint.config.js` | ESLint flat config |
| `config/.prettierrc` | Prettier config |
| `packages/cli/src/design.js` | Design class — main orchestrator (async using()) |
| `packages/cli/src/config.js` | YAML config loading & entity discovery |
| `packages/cli/src/references.js` | Dialect-agnostic reference resolution |
| `packages/cli/src/index.js` | CLI entry point (sade commands) |
| `packages/db/src/` | Entity processing, dependency resolver, adapter factory |
| `packages/dbml/src/` | DBML generation from DDL entities |
| `packages/postgres/src/` | PostgreSQL adapter (parse, classify, apply, import, export) |
| `packages/postgres/src/parser/` | SQL parser (pgsql-parser WASM, extractors, AST) |

- [ ] **Step 2: Commit CLAUDE.md**

```bash
cd /Users/Jerry/Developer/dbd
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md paths after repo restructure"
````

---

### Task 11: Update agents/memory.md paths

**Files:**

- Modify: `agents/memory.md`

- [ ] **Step 1: Update the Package Summary and Key Files sections**

In `agents/memory.md`:

1. Update the Architecture section to remove `solution/`:

```markdown
### Dependency Flow
```

cli -> db -> postgres (includes parser, reference-classifier, regex-fallback)
-> dbml

```

```

2. Update the Key Files for Resuming table — remove `solution/` prefix from all paths.

3. Update Current Status to note the restructure:

Add to Current Status:

```
- **Repo restructured:** monorepo workspace moved from solution/ to root; tool configs in config/
```

- [ ] **Step 2: Commit memory update**

```bash
cd /Users/Jerry/Developer/dbd
git add agents/memory.md
git commit -m "docs(agents): update memory.md paths after repo restructure"
```

---

## Chunk 6: Final Verification

### Task 12: Full end-to-end verification

- [ ] **Step 1: Clean install**

```bash
cd /Users/Jerry/Developer/dbd
rm -rf node_modules
bun install
```

Expected: installs cleanly, all workspace packages resolved.

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/Jerry/Developer/dbd
bun run test
```

Expected: all tests pass (684+). Zero failures or skips beyond baseline.

- [ ] **Step 3: Run lint and check for unexpected files**

```bash
cd /Users/Jerry/Developer/dbd
bun run lint 2>&1
```

Check: does prettier flag any files it shouldn't? Expected issues:

- `config/` files themselves: should be clean (we just wrote them)
- `agents/` markdown: these are not JS/TS so prettier may warn — if so, add `agents/**` to `config/.prettierignore` only if flagged
- `docs/` markdown: same — add to ignore only if flagged

If unexpected files appear, add them to `config/.prettierignore` and re-run.

- [ ] **Step 4: Verify prettier is NOT scanning coverage/**

```bash
cd /Users/Jerry/Developer/dbd
bun run coverage 2>&1 | tail -5
bun run lint 2>&1 | grep coverage
```

Expected: `grep coverage` returns nothing (coverage/ not mentioned in lint output).

- [ ] **Step 5: Verify bumpp config works**

```bash
cd /Users/Jerry/Developer/dbd
bun run bump -- --dry-run 2>&1 | head -10
```

Expected: shows version bump preview with `packages/*/package.json` files. Does NOT prompt errors about config not found.

- [ ] **Step 6: Verify eslint uses the correct config**

```bash
cd /Users/Jerry/Developer/dbd
bunx eslint --config config/eslint.config.js packages/cli/src/design.js 2>&1 | tail -5
```

Expected: warnings only (pre-existing), zero errors.

- [ ] **Step 7: Check git status is clean**

```bash
cd /Users/Jerry/Developer/dbd
git status
```

Expected: `working tree clean`.

- [ ] **Step 8: Final commit of any prettierignore fixes**

If step 3 revealed unexpected files that needed to be added to `config/.prettierignore`:

```bash
cd /Users/Jerry/Developer/dbd
git add config/.prettierignore
git commit -m "chore(config): update prettierignore to exclude non-source files"
```

---

## Summary of All Commits

| Commit                                                                         | What                       |
| ------------------------------------------------------------------------------ | -------------------------- |
| `chore: move solution/ contents to repo root, create config/ for tool configs` | All git mv operations      |
| `chore(config): update vitest.config.ts to resolve paths from repo root`       | vitest + prettierignore    |
| `chore: update scripts to reference config/ for all tool configs`              | package.json scripts       |
| `chore: reinstall dependencies at repo root after restructure`                 | bun.lock update            |
| `chore(ci): update publish.yml to reference packages/ at repo root`            | GitHub Actions             |
| `chore: add coverage/ to .gitignore at repo root`                              | .gitignore                 |
| `docs: update README for repo restructure`                                     | README.md                  |
| `docs: update CLAUDE.md paths after repo restructure`                          | CLAUDE.md                  |
| `docs(agents): update memory.md paths after repo restructure`                  | agents/memory.md           |
| (optional) `chore(config): update prettierignore to exclude non-source files`  | If needed after lint check |
