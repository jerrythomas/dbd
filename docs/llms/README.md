# DBD — LLM Documentation Index

This folder contains task-oriented documentation for using the `dbd` CLI tool.
It is optimised for LLM consumption: dense, concrete, no filler.

## What is dbd?

`dbd` is a CLI tool for managing PostgreSQL database schemas as code. It:

- Applies individual DDL scripts to a database in dependency order
- Tracks schema evolution with versioned snapshots and auto-generated migrations
- Loads staging data from CSV/TSV/JSON files
- Exports table data to files
- Generates DBML documentation for dbdocs.io

## Documents

| File                                                       | When to read                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [01-quickstart.md](./01-quickstart.md)                     | Starting a new project from scratch                                   |
| [02-design-yaml.md](./02-design-yaml.md)                   | Full `design.yaml` configuration reference                            |
| [03-ddl-patterns.md](./03-ddl-patterns.md)                 | How to write DDL files (tables, views, functions, procedures)         |
| [04-commands.md](./04-commands.md)                         | All CLI commands and options                                          |
| [05-import-export.md](./05-import-export.md)               | Loading and exporting data                                            |
| [06-dependency-graph.md](./06-dependency-graph.md)         | Dependency graph: how it's built, API, impact analysis, LLM use cases |
| [07-snapshots-migrations.md](./07-snapshots-migrations.md) | Schema evolution: snapshots, migrations, `_dbd_migrations` tracking   |

## Key facts at a glance

**Install:**

```sh
bun i --global @jerrythomas/dbd
```

**Scaffold a project:**

```sh
dbd init -p myproject
cd myproject
```

**Apply schema to a database:**

```sh
export DATABASE_URL=postgres://user:pass@localhost:5432/mydb
dbd apply
```

**Entity types:** `table`, `view`, `function`, `procedure`, `role`, `schema`, `extension`

**File path → entity name:** `ddl/table/config/lookups.ddl` → entity `config.lookups` of type `table`

**Entity types with schema** (`table`, `view`, `function`, `procedure`): file path is `ddl/<type>/<schema>/<name>.ddl`

**Entity types without schema** (`role`): file path is `ddl/role/<name>.ddl`

**Schemas and extensions** are declared in `design.yaml`, not in DDL files.
