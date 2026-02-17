# 02 — CLI Requirements

**Package:** Legacy `src/` (target: `packages/cli/`)

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

**Behavior:**

- Loads configuration, discovers files, resolves references
- Validates entity files, naming, and dependencies
- Reports valid entities as JSON, errors as structured messages

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
- Uses `psql` for execution

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
- Uses `\copy` for CSV/TSV, temp table + procedure for JSON

### `dbd export`

Extract data from tables/views as files.

| Option       | Default | Description           |
| ------------ | ------- | --------------------- |
| `-n, --name` | all     | Export specific table |

**Behavior:**

- Creates export directory structure matching schema layout
- Supports CSV, TSV, JSON, JSONL formats
- Uses `\copy` via `psql`

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

1. Discovers references by parsing SQL scripts (function calls, table references, trigger targets)
2. Filters out built-in functions (ANSI SQL, PostgreSQL internals, installed extensions)
3. Resolves references across search paths
4. Orders entities topologically for execution
5. Detects and flags cyclic dependencies
