# Plan: Adapter Restructure + SQLite Support

## Context

The adapter landscape has grown organically and no longer matches the intended pattern:

- `packages/postgres` contains two adapters (`PsqlAdapter`, `PgAdapter`) plus the parser — a single package doing too much
- `packages/convex` is a utility library, not an adapter — `design.js` special-cases it with `target === 'convex'` branches in both `apply()` and `importData()`
- Supabase is a config template only, no adapter
- No SQLite support

Goal: a clean `adapters/` folder where every database target is a proper `BaseDatabaseAdapter` implementation, and `design.js` has zero target-specific branches.

## Approach

### Folder structure

```
dbd/
  packages/
    cli/         — unchanged
    db/          — BaseDatabaseAdapter, factory, entity-processor (unchanged)
    dbml/        — unchanged
  adapters/
    postgres/    — PgAdapter (default) + PsqlAdapter (driver option), parser, reference-classifier
    supabase/    — SupabaseAdapter extends PgAdapter (skip managed schemas/extensions)
    sqlite/      — SqliteAdapter (new, uses better-sqlite3)
    convex/      — ConvexAdapter extends BaseDatabaseAdapter (replaces packages/convex)
```

Root `package.json` workspaces: `["packages/*", "adapters/*"]`

### Postgres: builder/factory with driver option

`createAdapter(url, { driver: 'pg' | 'psql' })` — default `'pg'`. Both adapters stay in
the same package (they share the parser). Factory selects the right class.

### Supabase: thin wrapper over PgAdapter

`SupabaseAdapter extends PgAdapter`:

- `applyEntity` skips managed schemas (`auth`, `storage`, `realtime`, `graphql_public`, `supabase_functions`)
- `applyEntity` skips extensions that Supabase pre-installs (`uuid-ossp`, `pgcrypto`, etc.)

Connection string is still a standard PostgreSQL URL.

### SQLite: new SqliteAdapter

Uses `better-sqlite3` (synchronous API, no extra deps).

- `executeScript(sql)` — `db.exec(sql)`
- `applyEntity(entity)` — reads file, strips unsupported DDL (schemas, extensions, roles), runs via `exec()`
- `importData(entity)` — reads CSV/TSV/JSON file, inserts rows via prepared statements
- No `parseEntityScript` / `parseTableSnapshot` — stub returns empty (no pgsql-parser for SQLite DDL)
- No migration support in this phase — stubs are no-ops
- Connection string = file path (e.g. `./local.db`)

Schema handling: SQLite has no schemas. Entity names like `config.profiles` strip the schema prefix → table name `profiles`.

### Convex: proper adapter, remove special-casing

`ConvexAdapter extends BaseDatabaseAdapter`:

- `applyEntities(entities)` override — calls `generateSchemaTs(tables, convexConfig)`, writes `convex/schema.ts`, deploys if env vars present. Key override because schema generation requires all entities at once.
- `applyEntity()` — no-op (individual entity apply is meaningless for Convex)
- `importData(entity)` — seeds via Convex CLI
- `executeScript()` — no-op
- Constructor takes `convexConfig` from options

`design.js`:

- `apply()`: check `adapter.prefersBatchApply()` — if true, call `applyEntities(validEntities)` instead of per-entity loop. `ConvexAdapter` returns `true`; all others return `false` (default in `BaseDatabaseAdapter`).
- Remove `target === 'convex'` branch from `apply()`
- Remove `target === 'convex'` branch from `importData()`

CLI:

- Remove `dbd convex schema` and `dbd convex seed` commands
- Remove `--target` option from `dbd apply` and `dbd import`
- `using()` registers `postgres`, `postgresql`, `supabase`, `sqlite`, `convex`

`packages/convex` — deleted after migration.

## Steps

- [x] Step 1: Update workspace config — add `"adapters/*"` to `package.json` workspaces; update vitest config to include adapter projects
- [x] Step 2: Create `adapters/postgres` — move `packages/postgres` contents, update package name to `@jerrythomas/dbd-postgres-adapter`, add `driver` option to `createAdapter()`
- [x] Step 3: Create `adapters/supabase` — `SupabaseAdapter extends PgAdapter`, skip Supabase-managed schemas/extensions in `applyEntity()`
- [x] Step 4: Create `adapters/convex` — `ConvexAdapter extends BaseDatabaseAdapter`, move + adapt code from `packages/convex`, implement `applyEntities()` and `importData()`
- [x] Step 5: Add `prefersBatchApply()` to `BaseDatabaseAdapter` (returns `false`); override to `true` in `ConvexAdapter`
- [x] Step 6: Update `design.js` — remove `target === 'convex'` branches from `apply()` and `importData()`; add batch-vs-individual check in `apply()` fresh path; register all adapters in `using()`
- [x] Step 7: Update CLI (`index.js`) — remove `dbd convex schema` / `dbd convex seed` commands; remove `--target` option from `dbd apply` and `dbd import`
- [x] Step 8: Create `adapters/sqlite` — `SqliteAdapter extends BaseDatabaseAdapter`, `better-sqlite3` dependency, `executeScript`, `applyEntity` (strip unsupported DDL, strip schema prefix), `importData` (CSV/TSV/JSON via prepared statements)
- [x] Step 9: Delete `packages/postgres` (done alongside Step 2 to resolve workspace name collision)
- [x] Step 10: Update all internal references (vitest project names, coverage config, `using()` registers supabase)
- [x] Step 11: Run `bun run test && bun run lint` — all tests pass, 0 errors
- [ ] Step 12: Commit

## Verification

```bash
# All tests pass after restructure
bun run test

# Postgres adapter still works (factory picks PgAdapter by default)
# Convex apply generates schema.ts (no --target needed)
# SQLite apply executes DDL against a .db file
# SQLite import loads CSV rows
bun run lint
```
