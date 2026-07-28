# CLI Commands Reference

## Global options

All commands accept these options:

| Option          | Short | Default         | Description                                         |
| --------------- | ----- | --------------- | --------------------------------------------------- |
| `--config`      | `-c`  | `design.yaml`   | Path to config file                                 |
| `--database`    | `-d`  | `$DATABASE_URL` | Database connection URL                             |
| `--environment` | `-e`  | `prod`          | Environment name                                    |
| `--preview`     | `-p`  | `false`         | Preview mode                                        |
| `--source`      | `-s`  | `.`             | Source directory or GitHub repo (`owner/repo/path`) |
| `--version`     | `-v`  |                 | Print version                                       |
| `--help`        | `-h`  |                 | Print help                                          |

**Database URL format:**

```
postgres://user:pass@host:port/dbname
```

The `DATABASE_URL` environment variable is read automatically. Pass `-d` to override.

### `--source`

Point dbd at a database project directory other than the current folder. Accepts local paths or GitHub repositories.

```sh
# Local path
dbd inspect --source ./projects/mydb

# GitHub shorthand (owner/repo/subfolder)
dbd inspect --source sensei-hq/daemon/database

# GitHub with branch/tag
dbd apply --source sensei-hq/daemon/database@v2.1 -d $DATABASE_URL

# Full GitHub URL
dbd inspect --source https://github.com/sensei-hq/daemon/tree/main/database
```

**GitHub source formats:**

| Format                                           | Example                          |
| ------------------------------------------------ | -------------------------------- |
| `owner/repo`                                     | `sensei-hq/daemon`               |
| `owner/repo/subfolder`                           | `sensei-hq/daemon/database`      |
| `owner/repo@ref`                                 | `sensei-hq/daemon@v2.1`          |
| `owner/repo/subfolder@ref`                       | `sensei-hq/daemon/database@main` |
| `https://github.com/owner/repo/tree/branch/path` | Full URL with branch and path    |

**Caching:** Individual commands cache GitHub downloads in `~/.cache/dbd/` for 1 hour. Running `dbd apply --source X` then `dbd import --source X` reuses the cached download.

**Private repos:** Set `GITHUB_TOKEN` environment variable for authentication.

---

## `dbd init`

Scaffold a new project from the example template.

```sh
dbd init                  # Creates a folder named "database"
dbd init -p myproject     # Creates a folder named "myproject"
```

Copies the bundled example project template. Works offline.

**Output:** A new folder containing `design.yaml`, `ddl/`, `import/` with example files.

---

## `dbd inspect`

Validate the project configuration and report errors and warnings.

```sh
dbd inspect                          # Validate all entities
dbd inspect -n config.users          # Inspect one entity by name
dbd inspect -vv                      # Verbose output (full entity JSON)
dbd inspect --no-cache               # Skip DB reference cache
```

With a database URL, `inspect` also resolves references against the live database catalog.

**Output:**

- `Everything looks ok` — no issues
- Errors: blocking issues (file missing, bad path, unresolved reference)
- Warnings: non-blocking (unresolved optional references)

**Use before `apply`** to catch configuration problems.

---

## `dbd apply`

Apply DDL scripts to the database in dependency order.

```sh
dbd apply                            # Apply all entities
dbd apply -n config.users            # Apply one entity only
dbd apply --dry-run                  # Print apply order without executing
dbd apply -c staging.yaml            # Use a different config file
dbd apply -d postgres://...          # Use a specific database URL
```

**Apply order** (always):

1. Schemas
2. Extensions
3. Roles
4. DDL entities (tables, views, functions, procedures) — topologically sorted

Entities with errors are skipped. Errors are printed and execution continues.

**Dry-run output format:**

```
<type> => <name> [using "<file>"]
```

---

## `dbd combine`

Combine all DDL scripts into a single SQL file.

```sh
dbd combine                          # Writes to init.sql
dbd combine -f bootstrap.sql         # Writes to bootstrap.sql
```

The combined file applies entities in the same order as `dbd apply`.
Useful for seeding a fresh database or checking into version control as a snapshot.

Entities with errors are excluded.

---

## `dbd import`

Load data files from `import/` into the database.

```sh
dbd import                           # Import all configured tables
dbd import -n staging.lookup_values  # Import one table by name
dbd import -n import/staging/lookups.csv  # Import by file path
dbd import --dry-run                 # Print what would be imported
dbd import -e dev                    # Load dev-only tables (import/dev/ folder)
dbd import -e prod                   # Load prod-only tables (import/prod/ folder)
```

**Execution order:**

1. Import all tables in entity dependency order
2. For each table with a matching `staging.import_<name>()` procedure, call it automatically
3. Run SQL files listed in `import.after`

**Supported formats:** `csv`, `tsv`, `json`, `jsonl`

**Truncate behavior:** Controlled by `import.options.truncate` in `design.yaml` (default: `true`).
When `true`, the table is truncated before loading. If truncate fails (e.g. FK constraint), falls back to `DELETE FROM`.

---

## `dbd export`

Export table data to files.

```sh
dbd export                           # Export all configured tables
dbd export -n config.lookups         # Export one table by name
```

**Output directory:** `export/<schema>/<name>.<format>` (created automatically).

**Supported formats:** `csv`, `tsv`, `json`, `jsonl`

Tables to export are configured under `export:` in `design.yaml`.

---

## `dbd reset`

Drop all schemas declared in `design.yaml`, returning the database to a bare state. Run `dbd apply` to rebuild.

```sh
dbd reset                            # Supabase-safe (default)
dbd reset --target postgres          # Full reset: drops schemas and roles
dbd reset --dry-run                  # Print what would be dropped
```

**`--target supabase` (default):** Drops only user-defined schemas. Supabase-managed schemas (`auth`, `storage`, `realtime`, etc.) are never touched. Roles are not dropped.

**`--target postgres`:** Drops all design.yaml schemas and roles (roles in reverse dependency order).

After reset, the database has no schemas. Run `dbd apply` to rebuild.

---

## `dbd grants`

Apply schema-level grants declared in `design.yaml` to Supabase PostgREST roles.

```sh
dbd grants                           # Apply all configured grants
dbd grants --dry-run                 # Print what would be granted
```

No-op when `--target postgres` (prints info message, exits cleanly).

Grants must be declared per-schema in `design.yaml`:

```yaml
schemas:
  - config:
      grants:
        anon: [usage, select]
        service_role: [usage, all]
```

For each grant entry, generates:

- `GRANT USAGE ON SCHEMA` (for `usage`)
- `GRANT ... ON ALL TABLES IN SCHEMA` (for table-level perms)
- `ALTER DEFAULT PRIVILEGES IN SCHEMA GRANT ... ON TABLES` (for future tables)

---

## `dbd snapshot`

Capture the current DDL state as a versioned snapshot and generate a migration folder.

```sh
dbd snapshot                              # Create next snapshot
dbd snapshot --name "add email column"   # Attach a description
dbd snapshot --list                       # List existing snapshots
```

Writes `snapshots/NNN.json` and, if there are schema changes, `migrations/NNN/` with `graph.json` and per-table ALTER SQL files.

The first snapshot (version 1) never generates a migration folder. An empty diff (no table structure changes) creates the snapshot JSON but no migration folder.

---

## `dbd migrate`

Apply pending schema migrations independently of `dbd apply`.

```sh
dbd migrate                         # Show status (same as --status)
dbd migrate --status                # Show local version vs DB version and pending list
dbd migrate --apply                 # Apply all pending migrations
dbd migrate --apply --dry-run       # Print SQL without executing
dbd migrate --apply --to 3          # Apply up to version 3 only
```

**Status output example:**

```
Local version:    3
Database version: 2

Pending migrations (1):
  002 → 003  alter: config.lookup_values
```

`dbd apply` also runs pending migrations automatically (interleaved with DDL). Use `dbd migrate --apply` when you want to run only the ALTER scripts without re-applying DDL files.

See [07-snapshots-migrations.md](./07-snapshots-migrations.md) for full details on the snapshot/migration system.

---

## `dbd deploy`

Deploy a database from a remote or local source in one step. Combines apply (with migrations) and import into a single command.

```sh
# Deploy from a GitHub repo
dbd deploy --source sensei-hq/daemon/database -d $DATABASE_URL

# Deploy a specific version
dbd deploy --source sensei-hq/daemon/database@v2.1 -d $DATABASE_URL

# Deploy from a local path
dbd deploy --source ./releases/database -d $DATABASE_URL

# Preview what would happen
dbd deploy --source sensei-hq/daemon/database -d $DATABASE_URL --dry-run
```

**Requires** both `--source` and `--database`.

**Execution sequence:**

1. **Fetch** — downloads from GitHub to a temp directory (or resolves local path)
2. **Apply** — runs `dbd apply` (schemas, extensions, roles, entities, plus any pending migrations)
3. **Import** — runs `dbd import` (loads staging data)
4. **Cleanup** — removes the temp directory (GitHub sources only)

**Output:**

```
Downloading from GitHub: sensei-hq/daemon/database

--- apply ---
Migrating config.lookups (v2 → v3)
...

--- import ---
Importing staging.lookups
Import complete.

Deploy complete.
```

**When to use `deploy` vs individual commands:**

| Scenario                                     | Command                         |
| -------------------------------------------- | ------------------------------- |
| Automate full deployment from a binary/CI    | `dbd deploy --source ...`       |
| Apply schema changes only (no data reload)   | `dbd apply --source ...`        |
| Run only pending ALTER scripts in production | `dbd migrate --apply`           |
| Check what's pending before deploying        | `dbd migrate --status`          |
| Preview migration SQL                        | `dbd migrate --apply --dry-run` |

**Cleanup:** Unlike individual commands (which cache downloads), `deploy` always cleans up temp files after completion. It's designed for one-shot automated deployments.

---

## `dbd dbml`

Generate DBML documentation files for dbdocs.io.

```sh
dbd dbml                             # Writes design.dbml (or multiple files)
dbd dbml -f schema.dbml              # Write to a specific file (single-doc projects)
```

For projects with multiple `dbdocs` keys in `design.yaml`, one file is generated per key:

- Key `base` → `design.dbml`
- Key `core` → `design-core.dbml`

Only `table` entities are included in DBML output.
Include/exclude filters from `design.yaml` apply per document.

---

## Exit codes

| Code     | Meaning                                    |
| -------- | ------------------------------------------ |
| `0`      | Success                                    |
| non-zero | Error (psql failure, missing config, etc.) |

## Environment variables

| Variable       | Used by                                     |
| -------------- | ------------------------------------------- |
| `DATABASE_URL` | All commands needing a database connection  |
| `GITHUB_TOKEN` | `--source` with private GitHub repositories |
