# 01 — Parser Design

**Package:** `@jerrythomas/dbd-parser` (`packages/parser/`)  
**Status:** Complete — full test coverage

## Architecture

Three-layer pipeline with fallback extraction:

```
SQL String
  │
  ▼
┌─────────────────────────────────────┐
│  Layer 1: Parsing (parsers/sql.js)  │
│  splitStatements() → parse()        │
│  Input:  raw SQL string             │
│  Output: AST array + original SQL   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Layer 2: Transformation (ast.js)       │
│  normalizeAst() per statement type      │
│  Input:  raw AST                        │
│  Output: normalized, consistent AST     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Layer 3: Extraction (extractors/*.js)   │
│  tables / views / procedures / indexes   │
│  Input:  normalized AST                  │
│  Output: structured metadata objects     │
└──────────────────────────────────────────┘
```

## Module Map

```
packages/parser/src/
├── index.js                  # Class-based API (SQLParser) + named exports
├── index-functional.js       # Functional API using Ramda composition
├── parser-utils.js           # SQLParser class implementation
├── parse-ddl.js              # Low-level DDL parsing utilities
├── parsers/
│   └── sql.js                # Statement splitting + node-sql-parser wrapper
├── transformers/
│   └── ast.js                # AST normalization per statement type
├── extractors/
│   ├── tables.js             # Table extraction (columns, constraints, comments)
│   ├── views.js              # View extraction (columns, dependencies, definition)
│   ├── procedures.js         # Procedure extraction (params, body, table refs)
│   └── db-indexes.js         # Index extraction (columns, unique, ordering)
└── utils/
    └── error-handler.js      # Configurable error collection
```

## Layer 1: Parsing (`parsers/sql.js`)

### Statement Splitting

`splitStatements(sql)` handles:

- Semicolon delimiters
- Dollar-quoted strings (`$$...$$`, `$tag$...$tag$`)
- Single/double-quoted strings with escape awareness
- Line comments (`--`) and block comments (`/* */`)

### AST Generation

`parse(sql, options)` orchestrates:

1. Split into individual statements
2. Parse each via `node-sql-parser` (PostgreSQL dialect)
3. Attach `_original_sql` to each AST node for fallback reference
4. Handle `SET search_path` specially — extract default schema
5. Return array of AST objects

## Layer 2: Transformation (`transformers/ast.js`)

`normalizeAst()` dispatches per statement type:

- `normalizeCreateTable()` — column defs, constraints
- `normalizeCreateView()` — select columns, FROM/JOIN sources
- `normalizeCreateIndex()` — table, columns, unique flag
- `normalizeCreateProcedure()` — params, body, language

Normalization flattens vendor-specific AST structures into a consistent shape.

## Layer 3: Extraction (`extractors/`)

Each extractor follows the same pattern:

1. Filter AST for relevant statement types
2. Extract `search_path` default schema
3. Map each statement to a metadata object
4. Apply `search_path` as default schema where not explicitly set
5. On parse failure: call fallback regex extractor (`extractXxxFromSql()`)

### Output Shapes

**Table:**

```javascript
{
  name: string, schema: string|null, ifNotExists: boolean,
  columns: [{ name, dataType, nullable, defaultValue, constraints: [{ type, table?, column? }] }],
  constraints: [],
  comments: { table: string|null, columns: { [name]: string } }
}
```

**View:**

```javascript
{
  name: string, schema: string|null, replace: boolean,
  columns: [{ name, source: { table?, column?, type?, expression? } }],
  dependencies: [{ table, schema?, alias?, joinType?, type? }],
  definition: string
}
```

**Procedure:**

```javascript
{
  name: string, schema: string|null, replace: boolean, language: string,
  parameters: [{ name, dataType, mode }],
  returnType: string|null, body: string, tableReferences: [string]
}
```

**Index:**

```javascript
{
  name: string, schema: string|null, table: string, tableSchema: string|null,
  unique: boolean, ifNotExists: boolean,
  columns: [{ name, order: 'ASC'|'DESC' }]
}
```

## Error Handling (`utils/error-handler.js`)

Configurable behavior:

- `collectErrors: true` (default) — accumulate errors in memory
- `logToConsole: false` (default) — silent for library/test use
- `throwOnError: false` (default) — never crash the caller

Error shape: `{ message, preview, context, timestamp, type: 'PARSING_ERROR' }`

Helper: `withErrorHandling(fn, context)` wraps any function with try/catch + collection.

## Fallback Extraction

Each extractor has a regex-based fallback:

- `extractViewsFromSql(sql, defaultSchema)` — matches `CREATE [OR REPLACE] VIEW ... AS SELECT ...`
- `extractProceduresFromSql(sql, defaultSchema)` — matches `CREATE [OR REPLACE] PROCEDURE ... AS $...$`
- `extractIndexesFromSql(sql, defaultSchema)` — matches `CREATE [UNIQUE] INDEX ... ON ... (...)`

Fallbacks return the same output shapes as AST extractors, with less detail (e.g., procedure body may be incomplete).

## Dual API

**Class-based** (`index.js`):

```javascript
import { SQLParser, parseSchema, extractTables, validate } from '@jerrythomas/dbd-parser'
```

**Functional** (`index-functional.js`):

```javascript
import {
  extractSchema,
  extractTableDefinitions,
  validateDDL
} from '@jerrythomas/dbd-parser/src/index-functional.js'
```

The functional API uses Ramda `pipe`, `filter`, `map` for composition.

## Dependencies

| Package           | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `node-sql-parser` | SQL string → AST                          |
| `ramda`           | Function composition, data transformation |

## Technical Debt

- `parser-utils.js` has a `testMode` flag for synthetic results — should be removed
- Class API and functional API partially overlap — consider consolidating
- Some extractors have duplicated schema resolution logic
