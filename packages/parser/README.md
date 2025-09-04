# SQL Parser for DDL Analysis

This directory contains a SQL parser implementation that can extract detailed metadata from DDL (Data Definition Language) scripts. It's particularly useful for parsing PostgreSQL schema definitions, including tables, views, procedures, indexes, and comments.

## Features

- **Parse DDL scripts** into a structured Abstract Syntax Tree (AST)
- **Extract metadata** for tables, columns, data types, constraints, etc.
- **Identify relationships** between database objects
- **Detect parsing errors** in SQL syntax
- **Build dependency graphs** for database objects
- **Compare table schemas** across different schemas or versions

## Components

- `parser-utils.spec.js` - Core parsing utilities and the `SQLParser` class
- `table.spec.js` - Tests for parsing table definitions
- `view.spec.js` - Tests for parsing view definitions
- `procedure.spec.js` - Tests for parsing procedure definitions
- `ddl-analyzer.spec.js` - Comprehensive analysis of DDL files
- `parse-ddl.js` - Command-line utility for parsing DDL files

## Usage

### Using the Command-Line Utility

```bash
# Basic usage - parse a DDL file and output JSON to stdout
bun run parse-ddl.js ../../ddl/table/config/lookups.ddl

# Output to a file in YAML format
bun run parse-ddl.js ../../ddl/table/config/lookups.ddl --format=yaml --output=schema.yaml

# Extract only table definitions
bun run parse-ddl.js ../../ddl/table/config/lookups.ddl --tables-only

# Just check for parsing errors
bun run parse-ddl.js ../../ddl/table/config/lookups.ddl --detect-errors
```

### Using the SQLParser Class

```javascript
import { SQLParser } from './parser-utils.spec.js'

// Create a parser instance
const parser = new SQLParser('PostgreSQL')

// Parse a DDL string
const ddlContent = `
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE users IS 'User accounts';
COMMENT ON COLUMN users.id IS 'Unique identifier';
`

// Extract the schema
const schema = parser.extractSchema(ddlContent)

// Access the extracted metadata
console.log(schema.tables[0].name) // "users"
console.log(schema.tables[0].columns[0].dataType) // "uuid"
console.log(schema.tables[0].comments.table) // "User accounts"
```

## The SQLParser Class

The `SQLParser` class provides methods for:

- `parse(sql)` - Parse SQL into an AST
- `extractSchema(sql)` - Extract a complete schema from SQL
- `extractTableDefinitions(ast)` - Extract table definitions from an AST
- `extractViewDefinitions(ast)` - Extract view definitions from an AST
- `extractProcedureDefinitions(ast)` - Extract procedure definitions from an AST
- `extractIndexDefinitions(ast)` - Extract index definitions from an AST

## Output Structure

The schema extraction produces a structured JSON object with the following format:

```json
{
  "tables": [
    {
      "name": "users",
      "schema": "public",
      "ifNotExists": true,
      "columns": [
        {
          "name": "id",
          "dataType": "uuid",
          "nullable": false,
          "defaultValue": null,
          "constraints": [
            { "type": "PRIMARY KEY" }
          ]
        },
        {
          "name": "username",
          "dataType": "varchar(50)",
          "nullable": false,
          "defaultValue": null,
          "constraints": []
        }
      ],
      "comments": {
        "table": "User accounts",
        "columns": {
          "id": "Unique identifier"
        }
      }
    }
  ],
  "views": [...],
  "procedures": [...],
  "indexes": [...]
}
```

## Prerequisites

This parser uses the `node-sql-parser` package. If it's not already installed, run:

```bash
bun add node-sql-parser
```

For YAML output in the command-line utility, the `js-yaml` package is required:

```bash
bun add js-yaml
```

## Running Tests

The tests are written using Vitest. To run them:

```bash
bun run vitest:unit parser/*
```
