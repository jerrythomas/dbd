# Import Environment Mode (dev/prod) — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Add environment-aware import so that different tables and post-import scripts run in `dev` vs `prod`. Default environment is `prod`. The existing `-e, --environment` CLI flag (declared but unused) is wired up and normalized.

---

## Environment Values

| Input                 | Normalized         |
| --------------------- | ------------------ |
| `prod`, `production`  | `'prod'`           |
| `dev`, `development`  | `'dev'`            |
| omitted / `undefined` | `'prod'` (default) |
| anything else         | throws             |

A `normalizeEnv(value)` utility handles this mapping.

---

## Config & YAML Schema

### Folder-based discovery

Files under `import/` are annotated with an env based on their path:

| Path                              | Env             |
| --------------------------------- | --------------- |
| `import/dev/staging/fixtures.csv` | `'dev'`         |
| `import/prod/staging/seeds.csv`   | `'prod'`        |
| `import/staging/lookups.csv`      | `null` (shared) |

### YAML `import.tables` — optional `env` field

```yaml
import:
  tables:
    - staging.lookup_values # shared (no env = both)
    - staging.dev_fixtures:
        env: dev # dev-only
    - staging.seed_data:
        env: [dev, prod] # explicit shared
```

`env` can be a string or array. No `env` field = shared (included in both envs).

### `import.after` — env-scoped post-import scripts

```yaml
import:
  after:
    - import/shared_loader.sql # always runs (existing behavior preserved)
  after.dev:
    - import/dev_loader.sql # only in dev
  after.prod:
    - import/prod_loader.sql # only in prod
```

---

## Entity Shape

Import entities gain an `env` field:

```js
{
  type: 'import',
  name: 'staging.seed_data',
  env: 'prod',   // 'dev' | 'prod' | null (shared)
  schema: 'staging',
  file: 'import/prod/staging/seed_data.csv',
  format: 'csv',
  truncate: true,
  nullValue: ''
}
```

---

## Component Changes

### `normalizeEnv(value)` — new utility (packages/cli/src/config.js or lib/env.js)

- Maps aliases to `'dev'` or `'prod'`
- Returns `'prod'` for `null`/`undefined`
- Throws for unrecognized values

### `cleanImportTables(data)` — packages/cli/src/config.js

- Annotates filesystem-discovered entities with env from path (`/dev/`, `/prod/`, or `null`)
- Annotates YAML-listed entities with env from `env:` field (normalize array → single value or `null` for shared)

### `using(configPath, databaseUrl, env)` — packages/cli/src/design.js

- Accepts `env` as third parameter
- Passes normalized env to `Design` constructor

### `Design` class — packages/cli/src/design.js

- Stores `#env` (normalized, default `'prod'`)
- `validate()` — adds env filter after existing schema check:
  - entity passes if `entity.env === null` (shared) or `entity.env === this.#env`
- `importData()` — after-scripts:
  - always runs `config.import.after` (shared)
  - runs `config.import['after.dev']` only when `#env === 'dev'`
  - runs `config.import['after.prod']` only when `#env === 'prod'`

### CLI — packages/cli/src/index.js

- Normalize `-e` value via `normalizeEnv()` before passing to `using()`
- Pass env as third arg to `using()`

---

## Data Flow

```
CLI: dbd import -e dev
  → normalizeEnv('dev') → 'dev'
  → using(config, db, 'dev')
    → Design({ env: 'dev' })
      → cleanImportTables()
          → scan('import/') → annotate env from path
          → merge with YAML tables (annotate env from entry)
      → validate()
          → keep: entity.env === null || entity.env === 'dev'
      → importData()
          → run filtered tables
          → run config.import.after        (shared)
          → run config.import['after.dev'] (env-specific)
```

---

## Tests

| Area                  | Cases                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `normalizeEnv()`      | `dev`, `development`, `prod`, `production`, `undefined` → default `prod`, invalid throws |
| `cleanImportTables()` | env annotation from `/dev/` path, `/prod/` path, ungrouped path                          |
| `cleanImportTables()` | env annotation from YAML: `env: dev`, `env: [dev, prod]`, no env field                   |
| `Design.validate()`   | dev entity excluded in prod; prod entity excluded in dev; shared entity included in both |
| `Design.importData()` | shared `after` always runs; `after.dev` only in dev; `after.prod` only in prod           |
| CLI                   | `-e development` normalizes to `'dev'`; no flag defaults to `'prod'`                     |
