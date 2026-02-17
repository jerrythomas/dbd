# 01 — Parser Requirements

**Package:** `@jerrythomas/dbd-parser` (`packages/parser/`)

## Purpose

Parse SQL DDL and extract structured metadata — tables, views, procedures, indexes, and their relationships.

## Functional Requirements

### FR-1: Schema Extraction

Given a SQL string containing DDL statements, the parser must extract:

| Object Type | Extracted Properties                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tables      | name, schema, columns (name, dataType, nullable, default, constraints), table comments, column comments                        |
| Views       | name, schema, columns (name, source), dependencies (tables/views referenced), definition SQL, CREATE OR REPLACE flag           |
| Procedures  | name, schema, parameters (name, dataType, mode), language, return type, body, table references in body, CREATE OR REPLACE flag |
| Indexes     | name, schema, table, unique flag, columns (name, order ASC/DESC), IF NOT EXISTS flag                                           |

### FR-2: Multi-Statement SQL

The parser must handle a single SQL string containing multiple statements separated by semicolons, including:

- Dollar-quoted strings (`$$...$$` and `$tag$...$tag$`)
- Single and double-quoted strings with escapes
- Line comments (`--`) and block comments (`/* */`)

### FR-3: Schema Qualification

- Parse `SET search_path TO schema1, schema2;` and apply as default schema to subsequent objects
- Handle explicit schema-qualified names (e.g., `config.lookups`)
- Objects without explicit schema inherit from search_path

### FR-4: Comment Association

- Parse `COMMENT ON TABLE schema.name IS '...'` statements
- Parse `COMMENT ON COLUMN schema.table.column IS '...'` statements
- Associate comments with the corresponding table/column in the extraction result

### FR-5: Fallback Extraction

When `node-sql-parser` fails to parse a statement (e.g., complex procedures, non-standard syntax):

- Fall back to regex-based extraction
- Collect the parse error without throwing
- Return partial results from the fallback

### FR-6: Validation

Given a SQL string, report whether it is valid DDL:

- Return `{ valid: true/false, message, errors? }`
- Errors include message, preview (first 100 chars), and context

### FR-7: Dual API

Provide both:

- **Class-based API** (`SQLParser`) — `parse()`, `extractTableDefinitions()`, `extractSchema()`, `validateDDL()`
- **Functional API** — `extractSchema()`, `extractTableDefinitions()`, `extractViewDefinitions()`, `extractProcedureDefinitions()`, `extractIndexDefinitions()`, `validateDDL()`

## Supported SQL Features

### Data Types

`int`, `serial`, `bigint`, `varchar(n)`, `text`, `boolean`, `timestamp [with time zone]`, `uuid`, `decimal(p,s)`, `jsonb`, `json`, `numeric`, `real`, `double precision`

### Constraints

- Column-level: `PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `DEFAULT`, `REFERENCES table(column)`
- Table-level: `PRIMARY KEY(cols)`, `FOREIGN KEY(cols) REFERENCES table(cols)`, `UNIQUE(cols)`

### Default Values

- Literals: strings, numbers, booleans
- Functions: `now()`, `uuid_generate_v4()`, `current_timestamp`

### Procedure Languages

`plpgsql`, `sql`

## Non-Functional Requirements

- PostgreSQL is the primary (and currently only) dialect
- Errors are collected, not thrown — library code must not crash the caller
- Console output is suppressed by default (test-friendly)
- Pure functions where possible, side effects only in error handler configuration

## Known Limitations (Accepted)

- Window functions not explicitly handled in view extraction
- Recursive CTEs not tracked in view dependencies
- Materialized views not distinguished from regular views
- Table-level constraint names not extracted
- `COMMENT ON FUNCTION/VIEW` not supported — only TABLE and COLUMN
- Partitioning directives not captured
