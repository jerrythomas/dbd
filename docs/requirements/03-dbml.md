# 03 — DBML Generation Requirements

**Package:** Legacy `src/collect.js` (target: `packages/dbml/`)

## Purpose

Generate DBML (Database Markup Language) files from DDL for publishing to [dbdocs.io](https://dbdocs.io).

## Functional Requirements

### FR-1: SQL-to-DBML Conversion

Given a set of DDL entities, generate valid DBML output:
- Convert `CREATE TABLE` statements to DBML table definitions
- Preserve column types, constraints, and comments
- Generate relationship references from foreign keys

### FR-2: Multiple Document Support

The `project.dbdocs` configuration supports multiple named DBML documents, each with independent filtering:

```yaml
dbdocs:
  base:                    # -> design-base.dbml
    exclude:
      schemas: [staging]
  core:                    # -> design-core.dbml
    include:
      schemas: [config]
```

Each document produces a separate `.dbml` file named `{file}-{key}.dbml`.

### FR-3: Schema/Table Filtering

Each DBML document can specify:
- `include.schemas` — only include tables from these schemas
- `include.tables` — only include these specific tables
- `exclude.schemas` — exclude tables from these schemas
- `exclude.tables` — exclude these specific tables

Include and exclude can be combined. Exclude takes precedence.

### FR-4: Schema-Qualified Names

Table names in DBML output must be schema-qualified (`schema.table_name`) to avoid ambiguity when multiple schemas are present.

### FR-5: Index Statement Removal

`CREATE INDEX` statements must be stripped before conversion — `@dbml/core` importer does not support them and they cause parse failures.

## Dependencies

- `@dbml/core` — SQL-to-DBML importer
- Parser package — for entity DDL extraction

## Known Limitations

- Index definitions are dropped (not representable in DBML via SQL import)
- View definitions not included in DBML output (DBML is table-focused)
- Procedure/function definitions not included
