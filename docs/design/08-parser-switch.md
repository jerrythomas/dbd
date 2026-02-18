# 08 — Parser Switch: node-sql-parser → pgsql-parser

**Status:** Proposed
**Prerequisite for:** Entity Classes (`06-entity-classes.md`)

## Motivation

`node-sql-parser` is a generic multi-dialect SQL parser written in JavaScript. It approximates PostgreSQL syntax but has known gaps:

| Construct                     | node-sql-parser      | pgsql-parser                    |
| ----------------------------- | -------------------- | ------------------------------- |
| CREATE TABLE                  | Yes                  | Yes                             |
| CREATE VIEW                   | Yes                  | Yes                             |
| CREATE FUNCTION (PL/pgSQL)    | Partial — body fails | Yes (body as string)            |
| CREATE PROCEDURE              | Partial              | Yes                             |
| CREATE TRIGGER                | **No**               | **Yes**                         |
| CREATE INDEX                  | Yes                  | Yes                             |
| JSONB operators (`->`, `->>`) | Partial              | Yes                             |
| Dollar-quoted strings         | Partial              | Yes                             |
| Custom types                  | Limited              | Yes                             |
| Round-trip (parse → deparse)  | No                   | Yes (23k+ statements validated) |

These gaps force a regex fallback path in `packages/cli/src/references.js` and throughout the parser extractors. With `pgsql-parser` (which uses the actual PostgreSQL C parser compiled to WASM), all PostgreSQL syntax is supported by definition.

## What is pgsql-parser?

Built on [libpg_query](https://github.com/pganalyze/libpg_query) — the PostgreSQL parser extracted from the PostgreSQL source code, compiled to WebAssembly. This means:

- **100% PostgreSQL syntax support** — it IS the PostgreSQL parser
- **Round-trip fidelity** — parse SQL → AST → deparse back to SQL
- **Version tracking** — supports PostgreSQL 15, 16, 17
- **Cross-platform** — WASM, no native compilation needed

### Ecosystem Packages

| Package          | Purpose                                   | Size           |
| ---------------- | ----------------------------------------- | -------------- |
| `pgsql-parser`   | Parse + deparse (main package)            | ~2.5 MB (WASM) |
| `pgsql-deparser` | AST → SQL only (TypeScript, no WASM)      | ~100 KB        |
| `@pgsql/types`   | TypeScript type definitions for AST nodes | ~200 KB        |
| `@pgsql/enums`   | PostgreSQL constant enums                 | ~50 KB         |

## AST Structure

`pgsql-parser` returns the PostgreSQL parse tree as JavaScript objects. The structure follows PostgreSQL's internal representation.

### Parse Output

```javascript
import { parse } from 'pgsql-parser'

const result = await parse('CREATE TABLE users (id int PRIMARY KEY)')
// Returns:
{
  version: 170007,          // PG version code
  stmts: [{
    stmt: {
      CreateStmt: {         // Node type as key
        relation: { relname: 'users', inh: true, relpersistence: 'p' },
        tableElts: [
          {
            ColumnDef: {
              colname: 'id',
              typeName: { names: [{ String: { sval: 'int4' } }] },
              constraints: [{ Constraint: { contype: 'CONSTR_PRIMARY' } }]
            }
          }
        ]
      }
    },
    stmt_location: 0
  }]
}
```

### Key AST Node Types

| DDL Statement    | AST Node Key          | Key Properties                                         |
| ---------------- | --------------------- | ------------------------------------------------------ |
| CREATE TABLE     | `CreateStmt`          | `relation`, `tableElts`, `constraints`                 |
| CREATE VIEW      | `ViewStmt`            | `view`, `query`, `replace`                             |
| CREATE FUNCTION  | `CreateFunctionStmt`  | `funcname`, `parameters`, `returnType`, `options`      |
| CREATE PROCEDURE | `CreateFunctionStmt`  | Same as function, `is_procedure: true`                 |
| CREATE TRIGGER   | `CreateTrigStmt`      | `trigname`, `relation`, `funcname`, `timing`, `events` |
| CREATE INDEX     | `IndexStmt`           | `idxname`, `relation`, `indexParams`, `unique`         |
| ALTER TABLE      | `AlterTableStmt`      | `relation`, `cmds`                                     |
| CREATE SCHEMA    | `CreateSchemaStmt`    | `schemaname`                                           |
| CREATE EXTENSION | `CreateExtensionStmt` | `extname`, `options`                                   |
| COMMENT ON       | `CommentStmt`         | `objtype`, `object`, `comment`                         |
| SET search_path  | `VariableSetStmt`     | `name: 'search_path'`, `args`                          |

### Column Definitions (ColumnDef)

```javascript
{
  ColumnDef: {
    colname: 'display_name',
    typeName: {
      names: [{ String: { sval: 'varchar' } }],
      typmods: [{ Integer: { ival: 255 } }]   // varchar(255)
    },
    is_not_null: false,
    constraints: [
      { Constraint: { contype: 'CONSTR_DEFAULT', raw_expr: { ... } } }
    ]
  }
}
```

### Constraint Nodes

| contype          | Meaning       |
| ---------------- | ------------- |
| `CONSTR_PRIMARY` | PRIMARY KEY   |
| `CONSTR_UNIQUE`  | UNIQUE        |
| `CONSTR_FOREIGN` | FOREIGN KEY   |
| `CONSTR_CHECK`   | CHECK         |
| `CONSTR_NOTNULL` | NOT NULL      |
| `CONSTR_DEFAULT` | DEFAULT value |

FK constraints include: `pktable`, `fk_attrs`, `pk_attrs`, `fk_del_action`, `fk_upd_action`.

## Migration Strategy

### Scope of Changes

The parser has a clean 3-layer architecture:

```
Layer 1: SQL Parsing        → packages/parser/src/parsers/sql.js
Layer 2: AST Extraction     → packages/parser/src/extractors/*.js
Layer 3: Functional API     → packages/parser/src/index-functional.js
```

**Layer 1** (parsing) needs full replacement — different API, different AST format.
**Layer 2** (extraction) needs rewriting — all AST property paths change.
**Layer 3** (functional API) stays unchanged — it returns domain objects, not AST.

Downstream packages (`cli`, `dbml`) consume Layer 3's output and are **not affected**.

### What Changes

| File                                           | Impact             | Description                              |
| ---------------------------------------------- | ------------------ | ---------------------------------------- |
| `packages/parser/package.json`                 | Replace dependency | `node-sql-parser` → `pgsql-parser`       |
| `packages/parser/src/parsers/sql.js`           | Rewrite            | New parse API, WASM initialization       |
| `packages/parser/src/parser-utils.js`          | Rewrite            | SQLParser class uses different AST       |
| `packages/parser/src/extractors/tables.js`     | Rewrite            | `CreateStmt` AST navigation              |
| `packages/parser/src/extractors/views.js`      | Rewrite            | `ViewStmt` AST navigation                |
| `packages/parser/src/extractors/procedures.js` | Rewrite            | `CreateFunctionStmt` AST navigation      |
| `packages/parser/src/extractors/db-indexes.js` | Rewrite            | `IndexStmt` AST navigation               |
| `packages/parser/src/extractors/triggers.js`   | **Rewrite**        | Finally has AST support (was regex-only) |
| `packages/parser/src/transformers/ast.js`      | Rewrite            | AST transformation helpers               |
| `packages/parser/spec/`                        | Update fixtures    | AST mock structures change               |

### What Does NOT Change

| File                                      | Why                                         |
| ----------------------------------------- | ------------------------------------------- |
| `packages/parser/src/index-functional.js` | Returns domain objects, not AST             |
| `packages/parser/src/index.js`            | Re-exports only                             |
| `packages/cli/src/references.js`          | Calls `extractDependencies()` — Layer 3 API |
| `packages/cli/src/design.js`              | Uses entity objects, not AST                |
| `packages/dbml/src/converter.js`          | Uses `ddlFromEntity()`, not parser directly |
| `packages/db/src/*`                       | No parser dependency                        |

### Regex Fallback Elimination

With `pgsql-parser`, the regex fallback path in extractors can be removed:

- `extractors/tables.js` — remove `extractTablesFromSql()` fallback
- `extractors/views.js` — remove `extractViewsFromSql()` fallback
- `extractors/procedures.js` — remove `extractRoutinesFromSql()` fallback
- `extractors/db-indexes.js` — remove `extractIndexesFromSql()` fallback
- `extractors/triggers.js` — rewrite from regex-only to AST-based
- `cli/references.js` — remove `parseEntityScriptRegex()` and all deprecated functions

This eliminates ~400 lines of regex extraction code and the dual-path complexity.

### Async Consideration

`pgsql-parser` offers both async and sync APIs:

```javascript
// Async (recommended — auto-initializes WASM)
import { parse, deparse } from 'pgsql-parser'
const ast = await parse(sql)

// Sync (requires explicit init)
import { parseSync, deparseSync, loadModule } from 'pgsql-parser'
await loadModule() // Once at startup
const ast = parseSync(sql)
```

**Recommendation:** Use sync API with explicit `loadModule()` at CLI startup. The parser is called many times during entity processing — sync avoids turning the entire extraction pipeline async. The WASM module loads once (~50ms) and all subsequent calls are synchronous.

```javascript
// In CLI startup (index.js or design.js constructor)
import { loadModule } from 'pgsql-parser'
await loadModule()

// In parser extractors (sync, no await needed)
import { parseSync } from 'pgsql-parser'
const ast = parseSync(sql)
```

## Implementation Phases

### Phase 1: Install and Validate (~2 hours)

1. Add `pgsql-parser` to `packages/parser/package.json`
2. Write a spike test: parse all DDL files in `example/` directory
3. Verify every file parses successfully (no exceptions)
4. Compare: which files currently fall back to regex? Do they parse with `pgsql-parser`?

### Phase 2: Core Parse Layer (~3 hours)

1. Rewrite `parsers/sql.js` to use `pgsql-parser`
2. Update `parser-utils.js` SQLParser class
3. Handle statement splitting (pgsql-parser handles multi-statement SQL natively)
4. Initialize WASM module at first use

### Phase 3: Extractors (~8-12 hours)

Rewrite each extractor to navigate `pgsql-parser` AST:

1. **tables.js** — `CreateStmt` → columns, constraints, types (largest)
2. **views.js** — `ViewStmt` → definition, dependencies, columns
3. **procedures.js** — `CreateFunctionStmt` → params, return type, body
4. **db-indexes.js** — `IndexStmt` → columns, method, uniqueness
5. **triggers.js** — `CreateTrigStmt` → table, function, timing, events (new!)
6. **ast.js** — update transformer helpers

### Phase 4: Remove Regex Fallbacks (~2 hours)

1. Remove regex extraction functions from all extractors
2. Remove `parseEntityScriptRegex()` from `cli/references.js`
3. Remove deprecated helper functions (`extractReferences`, `extractTableReferences`, etc.)
4. Clean up `isSqlExpression()` and related regex utilities

### Phase 5: Test Suite Update (~4 hours)

1. Update AST mock fixtures in spec files
2. Verify all 114 parser tests pass (may need fixture updates)
3. Verify all 55 CLI tests pass
4. Run full workspace tests (332 total)
5. Run e2e if PostgreSQL available

### Phase 6: Deparse Integration (~2 hours)

1. Add `deparse()` capability — used by entity classes for `toSQL()`
2. Verify round-trip: parse DDL → AST → deparse → same semantics
3. This enables entity classes to generate SQL from their AST representation

## Risk Mitigation

| Risk                                  | Mitigation                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| WASM binary size (~2.5MB)             | Acceptable for CLI tool; not a browser bundle                                 |
| Parse failures on edge-case SQL       | Real PG parser — if it fails, the SQL is invalid                              |
| Deparse produces different formatting | Semantically equivalent; formatting is cosmetic                               |
| Bun compatibility with WASM           | pgsql-parser documents Bun support                                            |
| Breaking test fixtures                | Tests verify extraction output, not AST shape — update fixtures incrementally |

## Verification

After the switch, these must pass:

1. `bun test:parser` — 114 tests (with updated fixtures)
2. `bun test:cli` — 55 tests
3. `bun test:unit` — all 332 workspace tests
4. `bun run lint` — 0 errors
5. Manual: `node packages/cli/src/index.js inspect` from `example/` directory
6. Parse every DDL file in `example/` without fallback
