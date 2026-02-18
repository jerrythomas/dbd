# 02 — CLI Requirements

**Package:** `packages/cli/` (`dbd`)

## Purpose

Provide a command-line interface for managing database schemas — applying DDL, importing/exporting data, generating documentation, and inspecting project structure.

## Commands

### `dbd init`

Initialize a starter project by cloning the example template.

| Option          | Default    | Description            |
| --------------- | ---------- | ---------------------- |
| `-p, --project` | `database` | Project directory name |

**Behavior:** Uses `degit` to clone `jerrythomas/dbd/example` into the target directory.

### `dbd inspect`

Validate and report on database structure.

| Option           | Default | Description             |
| ---------------- | ------- | ----------------------- |
| `-n, --name`     | all     | Inspect specific entity |
| `-vv, --verbose` | false   | Detailed error output   |
| `--no-cache`     | false   | Skip DB reference cache |

**Behavior:**

- Loads configuration, discovers files, resolves references
- Validates entity files, naming, and dependencies
- If a database URL is provided, resolves warnings against the DB catalog (caches results locally)
- Reports valid entities as JSON, errors and warnings as structured messages

### `dbd apply`

Execute DDL scripts against the database.

| Option       | Default | Description                               |
| ------------ | ------- | ----------------------------------------- |
| `-n, --name` | all     | Apply specific entity only                |
| `--dry-run`  | false   | Print execution sequence without applying |

**Behavior:**

- Validates all entities first
- Filters out entities with errors
- Executes in dependency order (schemas -> extensions -> roles -> tables -> views -> functions -> procedures)
- Uses database adapter for execution (programmatic, no `psql` dependency)

### `dbd combine`

Merge all DDL into a single deployment file.

| Option       | Default    | Description     |
| ------------ | ---------- | --------------- |
| `-f, --file` | `init.sql` | Output filename |

**Behavior:** Concatenates DDL from all valid entities in dependency order.

### `dbd import`

Load CSV/JSON data files into database tables.

| Option       | Default | Description               |
| ------------ | ------- | ------------------------- |
| `-n, --name` | all     | Import specific table     |
| `--dry-run`  | false   | Preview without executing |

**Behavior:**

- Only imports into staging schemas (configurable restriction)
- Supports CSV, TSV, JSON, JSONL formats
- Optionally truncates target table before import
- Executes post-import scripts (`import.after` in config)
- Uses database adapter for data loading (streaming COPY)

### `dbd export`

Extract data from tables/views as files.

| Option       | Default | Description           |
| ------------ | ------- | --------------------- |
| `-n, --name` | all     | Export specific table |

**Behavior:**

- Creates export directory structure matching schema layout
- Supports CSV, TSV, JSON, JSONL formats
- Uses database adapter for data extraction

### `dbd dbml`

Generate DBML documentation files.

| Option       | Default       | Description     |
| ------------ | ------------- | --------------- |
| `-f, --file` | `design.dbml` | Output filename |

**Behavior:**

- Generates one DBML file per `project.dbdocs` entry
- Filters entities by include/exclude schemas and tables
- Strips index creation statements (DBML incompatible)
- Uses `@dbml/core` importer for SQL-to-DBML conversion
- Replaces bare table names with schema-qualified names

## Global Options

| Option              | Default         | Description                      |
| ------------------- | --------------- | -------------------------------- |
| `-c, --config`      | `design.yaml`   | Path to config file              |
| `-d, --database`    | `$DATABASE_URL` | Database connection URL          |
| `-e, --environment` | `development`   | Environment to load              |
| `-p, --preview`     | false           | Preview action without execution |

## Configuration File (`design.yaml`)

The CLI reads a YAML configuration file that defines:

| Section      | Purpose                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `project`    | Name, database type, extension schema, staging schemas, dbdocs config      |
| `schemas`    | Schemas to create                                                          |
| `extensions` | PostgreSQL extensions to install                                           |
| `roles`      | Database roles with inheritance                                            |
| `import`     | Import options, table list, schema-specific overrides, post-import scripts |
| `export`     | Tables/views to export with format options                                 |

Entity definitions (tables, views, functions, procedures) are **discovered from the file system** and merged with config. Config entries can override discovered properties.

## Project Folder Structure (Expected)

```
project/
  design.yaml
  ddl/
    table/{schema}/{name}.ddl
    view/{schema}/{name}.ddl
    procedure/{schema}/{name}.ddl
    function/{schema}/{name}.ddl
    role/{name}.ddl
    extension/{name}.ddl
  import/
    {schema}/{name}.csv|tsv|json|jsonl
    loader.sql (post-import scripts)
  export/  (generated)
    {schema}/{name}.csv|...
```

## Validation Rules

1. Entity names must match file paths: `ddl/{type}/{schema}/{name}.{ext}`
2. Schema-qualified entities require `schema.name` format
3. All non-internal references must resolve to known entities
4. Cyclic dependencies are detected and flagged as errors
5. Import targets restricted to staging schemas
6. File extensions: `.ddl` or `.sql` for DDL; `.csv`, `.tsv`, `.json`, `.jsonl` for data

## Dependency Resolution

Entities declare dependencies via `refers` arrays. The CLI:

1. Discovers references by parsing SQL scripts using AST-based extraction (`@dbd/parser`), with regex fallback for unsupported SQL
2. Filters out built-in functions (ANSI SQL, PostgreSQL internals, installed extensions)
3. Resolves references across search paths
4. Orders entities topologically for execution
5. Detects and flags cyclic dependencies
6. Optionally validates unresolved references against the database catalog (DB reference cache)

## Planned Commands

### `dbd snapshot` (Planned)

Capture the current schema state as a versioned JSON snapshot.

| Option   | Default | Description              |
| -------- | ------- | ------------------------ |
| `--name` | none    | Description for snapshot |
| `--list` | false   | List existing snapshots  |

**Behavior:**

- Parses all DDL files, builds entity classes with full structured metadata
- Serializes to `snapshots/{version}.json` (sequential integer versioning)
- Captures columns, constraints, indexes, dependencies, function bodies

### `dbd migrate` (Planned)

Generate and apply migration scripts by diffing snapshots.

| Option     | Default | Description                    |
| ---------- | ------- | ------------------------------ |
| `--apply`  | false   | Apply pending migrations to DB |
| `--status` | false   | Show current DB version        |
| `--to`     | latest  | Apply migrations up to version |

**Behavior:**

- Diffs last snapshot against current DDL state
- Generates `migrations/{from}-to-{to}.sql` with ALTER/CREATE/DROP statements
- Tracks applied migrations in `_dbd_migrations` database table
- Each migration runs in a transaction with checksum verification

See `docs/design/07-snapshots-migrations.md` for full design.
