# CLI Commands Reference

## Global options

All commands accept these options:

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--config` | `-c` | `design.yaml` | Path to config file |
| `--database` | `-d` | `$DATABASE_URL` | Database connection URL |
| `--environment` | `-e` | `development` | Environment name |
| `--preview` | `-p` | `false` | Preview mode |
| `--version` | `-v` | | Print version |
| `--help` | `-h` | | Print help |

**Database URL format:**
```
postgres://user:pass@host:port/dbname
```

The `DATABASE_URL` environment variable is read automatically. Pass `-d` to override.

---

## `dbd init`

Scaffold a new project from the example template.

```sh
dbd init                  # Creates a folder named "database"
dbd init -p myproject     # Creates a folder named "myproject"
```

Uses `degit jerrythomas/dbd/example` under the hood. Requires internet access.

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
```

**Execution order:**
1. Import tables in entity dependency order
2. Run SQL files listed in `import.after` (e.g. `import/loader.sql`)

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

| Code | Meaning |
|------|---------|
| `0` | Success |
| non-zero | Error (psql failure, missing config, etc.) |

## Environment variables

| Variable | Used by |
|----------|---------|
| `DATABASE_URL` | All commands needing a database connection |
