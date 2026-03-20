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
2. Derive `targets` for each import plan entry (what the procedure writes to, filtered to non-staging schemas)

## Parser Changes

### `packages/postgres/src/parser/extractors/procedures.js`

Replace the flat `tableReferences: string[]` with two classified arrays on the parsed entity:

```js
{
  reads: string[],   // tables referenced in FROM, JOIN
  writes: string[]   // tables referenced in INSERT INTO, UPDATE, DELETE FROM
}
```

Both extractors change their return type from `string[]` to `{ reads: string[], writes: string[] }`. The call site in `procDefFromStatement` (which assigns to `tableReferences` today) changes to spread the result directly onto the entity as `reads` and `writes`. `extractRoutinesFromSql` (the regex-only fallback path) also spreads the result instead of assigning `tableReferences`.

#### Two extraction paths

`procDefFromStatement` chooses between paths based on whether the body text is available:

```js
// stmt.as is present → PL/pgSQL procedure with raw body text
// stmt.as is absent  → SQL function whose body was parsed into AST nodes
const { reads, writes } = stmt.as
  ? extractTableReferencesFromBody(stmt.as)
  : extractBodyReferencesFromAst(stmt)
```

**Import procedures are always PL/pgSQL** — they always go through the regex path.

#### `extractBodyReferencesFromAst` — SQL function path only

This path handles SQL functions (not PL/pgSQL), which are predominantly read-only SELECT bodies. The existing flat traversal looks for `node.table[]` and `node.from[]` in the parsed options. Since SQL function bodies are SELECT expressions, all table references are classified as **reads**. `writes` is always `[]` for this path.

Change: return `{ reads: Array.from(tables), writes: [] }` instead of `Array.from(tables)`.

#### `extractTableReferencesFromBody` — regex path (primary for import procedures)

The current function builds a single `Set` and returns `string[]`. Change to build two sets and return `{ reads: string[], writes: string[] }`.

Classification by matched keyword prefix (already captured as `match[1]`):

| Keyword | Direction |
|---------|-----------|
| `INSERT INTO` | write |
| `UPDATE` | write |
| `DELETE FROM` | write |
| `ALTER TABLE` | write |
| `CREATE TABLE` | write |
| `FROM` | read |
| `JOIN` | read |

The existing `nonTableWords` filter and quote-stripping are unchanged.

#### Name qualification

Both extractors should produce **fully qualified names** wherever the schema is known (e.g. `staging.lookups`). When the body references an unqualified name and no schema can be inferred from the AST, the name is stored as-is (unqualified). The import plan matching in `findImportProcedure` matches against `importTable.name` (always fully qualified), so unqualified reads will not match — this is acceptable since well-written procedure bodies qualify their table references. A warning is issued for staging tables with no matched procedure (existing behaviour).

### `packages/postgres/src/parser/index-functional.js` — `collectProcRefs`

`collectProcRefs` currently iterates `proc.tableReferences`. Change to use the union of reads and writes:

```js
// Before
for (const tableRef of proc.tableReferences || []) {
  refs.push({ name: tableRef, type: 'table/view' })
}

// After
for (const tableRef of [...(proc.reads ?? []), ...(proc.writes ?? [])]) {
  refs.push({ name: tableRef, type: 'table/view' })
}
```

The dependency graph and `sortByDependencies` are unchanged — a procedure still depends on all referenced tables regardless of direction.

## Import Plan Changes

### `findImportProcedure(importTable, entities)` — signature unchanged

Replace naming-convention matching with reads-based matching:

```js
// Before: naming convention
const procedureName = `${schema}.import_${baseName}`
return entities.find(e => e.type === 'procedure' && e.name === procedureName)

// After: reads-based
return entities.find(
  e => e.type === 'procedure' && (e.reads ?? []).includes(importTable.name)
) ?? null
```

### `findTargetTable(importTable, entities)` — unchanged

`findTargetTable` continues to find the matching production table by base name (e.g. `staging.lookups` → `config.lookups`). It is used for ordering when no procedure is matched. No changes.

### `buildImportPlan(importTables, entities)` — signature unchanged

The entry shape gains a `targets` field:

```js
// Before
{ table, targetTable, procedure, warnings }

// After
{ table, targetTable, procedure, targets, warnings }
```

`targets` — the non-staging tables the procedure writes to:

```js
// Derive staging schemas from the import tables themselves (no config needed)
const stagingSchemas = [...new Set(importTables.map(t => t.name.split('.')[0]))]

const targets = procedure
  ? (procedure.writes ?? []).filter(name => !stagingSchemas.includes(name.split('.')[0]))
  : []
```

Ordering continues to use `targetTable` (from `findTargetTable`) as before.

### Edge cases

| Scenario | Behaviour |
|----------|-----------|
| No procedure reads from this staging table | `null` — warning issued (same as today) |
| Multiple procedures read from same staging table | First match wins; warning issued for ambiguity |
| Procedure reads staging table and non-staging tables (cross-procedure FK) | Ordering handled by dependency graph — `sortByDependencies` places prerequisite procedures first |
| Unqualified table name in procedure body | Does not match fully-qualified staging table name; no procedure matched; warning issued |

### `Design.importTables` getter — `packages/cli/src/design.js`

Add `targets` to the destructured plan entry:

```js
// Before
return this.#importTables.map(({ table, procedure, warnings: planWarnings }) => ({
  ...table,
  procedure,
  warnings: [...(table.warnings || []), ...planWarnings]
}))

// After
return this.#importTables.map(({ table, procedure, targets, warnings: planWarnings }) => ({
  ...table,
  procedure,
  targets,
  warnings: [...(table.warnings || []), ...planWarnings]
}))
```

Note: `targetTable` (singular) is present on each `buildImportPlan` entry for dependency-ordering purposes only and is intentionally not forwarded through the getter. `targets` (plural, derived from `procedure.writes`) is the externally visible field for production table information.

## What This Enables

- **Cross-schema disambiguation** — two procedures writing to `config.users` vs `audit.users` are unambiguously distinct; only reads-based matching reveals the correct staging→target flow
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
| `packages/postgres/src/parser/extractors/procedures.js` | `extractBodyReferencesFromAst` and `extractTableReferencesFromBody` return `{ reads, writes }` instead of `string[]`; `procDefFromStatement` and `extractRoutinesFromSql` spread `reads`/`writes` onto entity; `tableReferences` removed |
| `packages/postgres/src/parser/index-functional.js` | `collectProcRefs` iterates `[...reads, ...writes]` instead of `tableReferences` |
| `packages/postgres/spec/` | Update procedure extractor tests for `reads`/`writes` shape |
| `packages/db/src/entity-processor.js` | `findImportProcedure` uses reads; `buildImportPlan` adds `targets` to plan entries |
| `packages/db/spec/entity-processor.spec.js` | Update tests for new matching logic and `targets` field |
| `packages/cli/src/design.js` | `importTables` getter destructures and passes through `targets` |
| `packages/cli/spec/design.spec.js` | Update if tests check import plan entry shape |

## Testing

**`procedures.spec.js`:**
- Procedure with only reads: `reads` contains tables, `writes` is empty
- Procedure with only writes: `writes` contains tables, `reads` is empty
- Procedure with both: correct classification for each table
- INSERT with SELECT subquery: INSERT target in `writes`, SELECT sources in `reads`
- Regex fallback: same classification rules apply
- `tableReferences` field is absent from parsed output

**`entity-processor.spec.js`:**
- `findImportProcedure`: matches staging table via `reads` field, not procedure name
- `findImportProcedure`: returns `null` when no procedure reads from the table
- `findImportProcedure`: returns first match and issues warning when multiple procedures read from same table
- `buildImportPlan`: `targets` populated from procedure `writes` filtered to non-staging schemas
- `buildImportPlan`: `targets` is `[]` when no procedure matched
- `buildImportPlan`: staging-schema writes excluded from `targets`
