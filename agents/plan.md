# Plan: Snapshots & Migrations

## Context

DDL files always reflect the desired final state. When a column is added to a DDL file, the DB needs an `ALTER TABLE ADD COLUMN` — not a `CREATE TABLE` re-run. Migrations bridge the gap between the current DB state and the new desired state.

`dbd apply` remains unchanged (clean slate). Migrations are a separate incremental workflow for staging/prod.

## Approach

### Snapshot

`dbd snapshot` (manual, not automatic) does two things:

1. Parses all table DDL files → structured column/index/FK data → writes `snapshots/N.json`
2. Diffs against `snapshots/N-1.json` → generates `migrations/(N-1)-to-N.sql`

### Migration SQL (tables/indexes/FK refs only)

Views, functions, procedures, triggers are NOT in migration SQL — they use `CREATE OR REPLACE` via `dbd apply`. Within a migration file, ordering is:

1. CREATE new schemas (IF NOT EXISTS)
2. CREATE new tables (dependency order)
3. ALTER TABLE ADD/MODIFY COLUMN
4. CREATE/DROP INDEX
5. ADD/DROP FK constraints
6. ALTER TABLE DROP COLUMN (destructive — last)
7. DROP TABLE (reverse dep order — destructive last)

### Version tracking

- Local version = highest N in `snapshots/` directory
- DB version = `MAX(version)` from `_dbd_migrations` table
- `dbd migrate --status` shows both

### Workflow (staging/prod)

```
dbd snapshot             → creates snapshots/N.json + migrations/(N-1)-to-N.sql
dbd migrate --status     → local N vs DB version
dbd migrate --apply      → apply pending migrations, record in _dbd_migrations
dbd import               → load data (after schema is up to date)
```

### Snapshot format

```json
{
  "version": 2,
  "description": "add users table",
  "timestamp": "2026-03-30T...",
  "tables": [
    {
      "name": "config.profiles",
      "schema": "config",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "default": "uuid_generate_v4()",
          "constraints": [{ "type": "PRIMARY KEY" }]
        },
        {
          "name": "email",
          "type": "varchar(255)",
          "nullable": false,
          "default": null,
          "constraints": [{ "type": "FOREIGN KEY", "table": "auth.users", "column": "email" }]
        }
      ],
      "indexes": [
        {
          "name": "idx_profiles_email",
          "unique": true,
          "columns": [{ "name": "email", "order": "ASC" }]
        }
      ]
    }
  ]
}
```

### `_dbd_migrations` table

```sql
CREATE TABLE IF NOT EXISTS _dbd_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text,
  checksum    text NOT NULL
);
```

## New files

- `packages/cli/src/snapshot.js` — snapshot file I/O
- `packages/db/src/schema-diff.js` — pure diff function
- `packages/db/src/migration-generator.js` — diff → ordered SQL

## Modified files

- `packages/postgres/src/parser/extractors/tables.js` — implement `extractTableConstraints` (table-level FKs)
- `packages/postgres/src/psql-adapter.js` — `parseTableSnapshot()`, `ensureMigrationsTable()`, `getDbVersion()`, `applyMigration()`
- `packages/db/src/base-adapter.js` — interface stubs for above 4 methods
- `packages/db/src/index.js` — export `diffSnapshots`, `generateMigrationSQL`
- `packages/cli/src/index.js` — add `dbd snapshot` and `dbd migrate` commands

## Steps

- [x] Step 1: Implement `extractTableConstraints` — table-level FK constraints in `packages/postgres/src/parser/extractors/tables.js`
- [x] Step 2: Add `parseTableSnapshot(entity)` to `BaseDatabaseAdapter` (stub) and `PsqlAdapter` (impl) — reads DDL → `{name, schema, columns, indexes}`
- [x] Step 3: Implement `packages/db/src/schema-diff.js` — `diffSnapshots(from, to)` pure function (table add/drop/alter, column add/drop/modify, index add/drop, FK add/drop)
- [x] Step 4: Implement `packages/db/src/migration-generator.js` — `generateMigrationSQL(diff, fromVersion, toVersion)` → ordered SQL string
- [x] Step 5: Implement `packages/cli/src/snapshot.js` — `readSnapshot`, `latestSnapshot`, `listSnapshots`, `createSnapshot`
- [x] Step 6: Add `ensureMigrationsTable`, `getDbVersion`, `applyMigration` to `BaseDatabaseAdapter` and `PsqlAdapter`
- [x] Step 7: Add `dbd snapshot [--name] [--list]` and `dbd migrate [--apply] [--status] [--to N]` commands to `packages/cli/src/index.js`
- [x] Step 8: Unit tests — `schema-diff.spec.js`, `migration-generator.spec.js`, `snapshot.spec.js`
- [x] Step 9: Run `bun run test && bun run lint` — 941 tests passing, 0 errors
- [ ] Step 10: Commit

## Verification

```bash
# Create snapshot (requires DDL files and snapshots/ dir)
dbd snapshot --name "initial schema"
# → writes snapshots/001.json
# → no migration (first snapshot)

dbd snapshot --name "add email column"
# → writes snapshots/002.json
# → writes migrations/001-to-002.sql with ALTER TABLE ADD COLUMN email...

dbd migrate --status
# → Local version: 2, DB version: 0 (or 1)

dbd migrate --apply
# → Applying 001-to-002.sql... Migration 2 applied.

# Tests pass
bun run test
```
