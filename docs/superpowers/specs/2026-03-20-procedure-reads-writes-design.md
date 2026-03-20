# Design: Procedure Read/Write Classification

**Date:** 2026-03-20
**Status:** Approved

## Problem

The import plan matches procedures to staging tables by naming convention (`staging.import_<name>`). This is fragile:

1. Procedures that don't follow the convention are silently skipped
2. When two schemas have a table with the same name (e.g. `config.users` and `audit.users`), the name alone cannot disambiguate which staging procedure handles which target
3. The import plan has no knowledge of what production tables a procedure populates — useful for warnings, dry-run output, and graph visualization

The PostgreSQL parser already extracts table references from procedure bodies. We just aren't classifying them by direction (read vs write).

## Solution

Enhance the procedure extractor to classify each table reference as a **read** (SELECT source) or **write** (INSERT/UPDATE/DELETE target), producing `reads: string[]` and `writes: string[]` on the parsed entity. Use these fields to:

1. Match procedures to staging tables by what they actually read (replacing naming convention)
2. Derive `targets` for each import plan entry (what the procedure writes to)

## Parser Changes

### `packages/postgres/src/parser/extractors/procedures.js`

Replace the flat `tableReferences: string[]` with:

```js
{
  reads: string[],   // FROM, JOIN
  writes: string[]   // INSERT INTO, UPDATE, DELETE FROM
}
```

Classification rules:

| SQL pattern | Classification |
|-------------|----------------|
| `INSERT INTO <table>` | write |
| `UPDATE <table> SET` | write |
| `DELETE FROM <table>` | write |
| `FROM <table>` | read |
| `JOIN <table>` | read |
| INSERT with SELECT subquery | INSERT target = write, SELECT sources = reads |

Both `extractBodyReferencesFromAst` (AST path) and `extractTableReferencesFromBody` (regex fallback) are updated. The AST path classifies by node type (`InsertStmt`, `UpdateStmt`, `DeleteStmt` → writes; `SelectStmt` sources → reads). The regex path classifies by the matched keyword prefix.

### `packages/postgres/src/parser/index-functional.js`

Wherever `tableReferences` was used to build `refers`, replace with `[...(entity.reads ?? []), ...(entity.writes ?? [])]`. The dependency graph and `sortByDependencies` are unchanged — a procedure depends on all referenced tables regardless of direction.

## Import Plan Changes

### `findImportProcedure(importTable, entities)`

```js
// Before: naming convention
const procedureName = `${schema}.import_${baseName}`
return entities.find(e => e.type === 'procedure' && e.name === procedureName)

// After: reads-based matching
return entities.find(
  e => e.type === 'procedure' && (e.reads ?? []).includes(importTable.name)
)
```

### `findTargetTable(procedure, importTables)`

```js
// Before: naming convention (extract table name from procedure name)
// After: reads-based matching
return importTables.find(t => (procedure.reads ?? []).includes(t.name))
```

### Edge cases

| Scenario | Behaviour |
|----------|-----------|
| No procedure reads from this staging table | `null` — warning issued (same as today) |
| Multiple procedures read from same staging table | First match wins; warning issued for ambiguity |
| Procedure reads staging table and non-staging tables | Normal — non-staging reads are cross-procedure dependencies handled by `sortByDependencies` |

Ordering between procedures is handled by the existing dependency graph: if procedure B reads from a table that procedure A writes to, `sortByDependencies` already places A before B. No special ordering logic needed in the import plan.

### Plan entry enrichment

Each `buildImportPlan` entry gains a `targets` field:

```js
{
  table,       // staging table being imported
  procedure,   // matched procedure (or null)
  targets,     // procedure.writes filtered to non-staging schemas ([] if no procedure)
  warnings
}
```

`targets` derivation:

```js
const targets = procedure
  ? (procedure.writes ?? []).filter(t => !stagingSchemas.includes(t.split('.')[0]))
  : []
```

`stagingSchemas` comes from `config.project.staging`.

The `Design.importTables` getter passes through `targets` alongside the existing spread.

## What This Enables

- **Cross-schema disambiguation** — two procedures writing to `config.users` vs `audit.users` are unambiguously distinct
- **Naming convention independence** — any procedure that reads from a staging table is discovered automatically
- **`dbd inspect` warnings** — can flag if a procedure writes to a table not in the design
- **Richer dry-run output** — future: show full data flow `staging.lookups → [import_lookups] → config.lookups`
- **Graph enrichment** — future: import flow as a subgraph

## Out of Scope

- Updating `dbd graph` to show import flow subgraph (follow-on)
- Dry-run output showing source→target flow (follow-on)
- Changes to `references.js`, `dependency-resolver.js`, or CLI commands

## Files Changed

| File | Change |
|------|--------|
| `packages/postgres/src/parser/extractors/procedures.js` | Split `tableReferences` → `reads` + `writes` in both AST and regex extractors |
| `packages/postgres/src/parser/index-functional.js` | Use `[...reads, ...writes]` in place of `tableReferences` when building `refers` |
| `packages/postgres/spec/` | Update procedure extractor tests for new `reads`/`writes` shape |
| `packages/db/src/entity-processor.js` | Update `findImportProcedure` and `findTargetTable`; enrich `buildImportPlan` entries with `targets` |
| `packages/db/spec/entity-processor.spec.js` | Update tests for new matching logic and `targets` field |
| `packages/cli/src/design.js` | Update `importTables` getter to pass through `targets` |
| `packages/cli/spec/design.spec.js` | Update tests if they check import plan shape |

## Testing

**`procedures.spec.js`:**
- Procedure with only reads: `reads` contains tables, `writes` is empty
- Procedure with only writes: `writes` contains tables, `reads` is empty
- Procedure with both: correct classification for each table
- INSERT with SELECT subquery: INSERT target in `writes`, SELECT sources in `reads`
- Regex fallback: same classification rules apply
- `tableReferences` field is absent from parsed output

**`entity-processor.spec.js`:**
- `findImportProcedure`: matches by `reads`, not by name
- `findImportProcedure`: returns `null` when no procedure reads from the table
- `findImportProcedure`: warns on multiple matches
- `findTargetTable`: matches by `reads`
- `buildImportPlan`: `targets` field populated from procedure `writes`
- `buildImportPlan`: `targets` is `[]` when no procedure matched
- `buildImportPlan`: `targets` excludes staging-schema tables
