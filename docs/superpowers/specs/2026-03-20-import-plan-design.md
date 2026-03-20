# Design: Auto-sequenced Import Plan

**Date:** 2026-03-20
**Status:** Approved

## Problem

Two issues with the current import flow:

1. **`organizeImports()` is broken.** It tries to order staging import tables by matching `staging.lookups` against entity names like `config.lookups` — these never match, so `order` is always -1 and the sort is a no-op.

2. **Import procedure calls require a manually maintained `loader.sql`.** After staging CSVs are loaded, a human must maintain `loader.sql` (and `after.dev` / `after.prod` variants) listing the procedure calls in the correct dependency order. This is error-prone and redundant — the dependency graph already knows the order.

## Solution

Replace `organizeImports()` with `buildImportPlan()` — a pure function that returns a fully-ordered plan connecting each staging import table to its target table and import procedure. Both `importData()` and `inspect` consume the same plan structure.

## Naming Convention

| Staging table     | Target table      | Import procedure           |
| ----------------- | ----------------- | -------------------------- |
| `staging.lookups` | `config.lookups`  | `staging.import_lookups`   |
| `staging.lookup_values` | `config.lookup_values` | `staging.import_lookup_values` |

- Target table: same base name as staging table, any non-staging schema
- Import procedure: `{staging_schema}.import_{base_name}` (procedure entity in DDL)

## Plan Entry Shape

```js
{
  table:       importTableEntity,   // the staging import table
  targetTable: entityOrNull,        // matched target table (e.g. config.lookups)
  procedure:   entityOrNull,        // staging.import_lookups procedure entity
  warnings:    string[]             // e.g. "no import procedure for staging.dev_fixture_table"
}
```

## New Pure Functions — `entity-processor.js`

### `findTargetTable(importTable, entities)`

Finds the target table by matching base name across non-staging schemas.

```js
// staging.lookups → config.lookups
const baseName = importTable.name.split('.')[1]
return entities.find(
  e => e.type === 'table' && e.name.split('.')[1] === baseName && e.schema !== importTable.schema
) ?? null
```

### `findImportProcedure(importTable, entities)`

Finds the import procedure by naming convention.

```js
// staging.lookups → staging.import_lookups
const [schema, baseName] = importTable.name.split('.')
const procedureName = `${schema}.import_${baseName}`
return entities.find(e => e.type === 'procedure' && e.name === procedureName) ?? null
```

### `buildImportPlan(importTables, entities)`

Builds the ordered plan. Sorting: by target table's position in the dependency-sorted entity list (tables without a matched target go last).

```js
export function buildImportPlan(importTables, entities) {
  const tables = entities.filter(e => e.type === 'table')

  return importTables
    .map(table => {
      const targetTable = findTargetTable(table, entities)
      const procedure = findImportProcedure(table, entities)
      const warnings = procedure ? [] : [`no import procedure for ${table.name}`]
      const order = targetTable ? tables.findIndex(t => t.name === targetTable.name) : Infinity
      return { table, targetTable, procedure, warnings, order }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _, ...entry }) => entry)
}
```

## Changes to `design.js`

### Constructor

Replace `organizeImports(config.importTables)` with `buildImportPlan(config.importTables, config.entities)`.
Store as `#importPlan` (rename from `#importTables` for clarity).

### `validate()`

Filter and validate `entry.table` per plan entry. Merge plan warnings into entry warnings so they surface via `report()`.

```js
this.#importPlan = buildImportPlan(config.importTables, config.entities)
  .filter(({ table }) => table.env === null || table.env === this.#env)
  .map(entry => ({ ...entry, table: validateEntity(entry.table, false) }))
  .map(entry => {
    if (!allowedSchemas.includes(entry.table.schema))
      return { ...entry, table: { ...entry.table, errors: [...(entry.table.errors || []), 'Import is only allowed for staging schemas'] } }
    return entry
  })
```

### `report()`

Collect issues and warnings from plan entries:

```js
const importIssues = this.importPlan
  .filter(({ table }) => table.errors?.length > 0)
  .map(({ table }) => table)

const importWarnings = this.importPlan
  .filter(({ table, warnings }) => table.warnings?.length > 0 || warnings.length > 0)
  .map(({ table, warnings }) => ({ ...table, warnings: [...(table.warnings || []), ...warnings] }))
```

### `importData()`

Iterate the plan. Call procedure after each CSV load. Dry-run prints both.

```js
async importData(name, dryRun = false) {
  if (!this.isValidated) this.validate()

  const plan = this.importPlan
    .filter(({ table }) => !table.errors?.length)
    .filter(({ table }) => !name || table.name === name || table.file === name)

  if (dryRun) {
    for (const { table, procedure, warnings } of plan) {
      console.info(`[dry-run] import: ${table.name}`)
      console.info(importScriptForEntity(table))
      warnings.forEach(w => console.warn(`[warning] ${w}`))
      if (procedure) console.info(`[dry-run] call ${procedure.name}();`)
    }
    return this
  }

  const adapter = await this.getAdapter()
  for (const { table, procedure, warnings } of plan) {
    console.info(`Importing ${table.name}`)
    warnings.forEach(w => console.warn(w))
    await adapter.importData(table)
    if (procedure) {
      console.info(`Calling ${procedure.name}`)
      await adapter.executeScript(`call ${procedure.name}();`)
    }
  }
  return this
}
```

Note: `import.after` / `import.after.{env}` config keys are preserved for post-import SQL beyond procedure calls, but `loader.sql` is no longer needed and should be removed from example projects.

## `dbd inspect` — Import Plan Section

`report()` already surfaces procedure warnings through the existing warnings mechanism. No changes needed to `index.js`.

Example inspect output when a procedure is missing:

```
Warnings:

import/staging/dev_fixture_table.csv =>
  no import procedure for staging.dev_fixture_table
```

## Example Project Updates

- Delete `example/import/loader.sql`
- Delete `example/import/dev_loader.sql`
- Delete `example/import/prod_loader.sql`
- Remove `after`, `after.dev`, `after.prod` keys from `example/design.yaml`

## Files Changed

| File | Change |
| ---- | ------ |
| `packages/db/src/entity-processor.js` | Add `findTargetTable`, `findImportProcedure`, `buildImportPlan` |
| `packages/db/src/index.js` | Export the three new functions |
| `packages/cli/src/design.js` | Replace `organizeImports`, update `validate`, `report`, `importData` |
| `example/design.yaml` | Remove `after`, `after.dev`, `after.prod` |
| `example/import/loader.sql` | Delete |
| `example/import/dev_loader.sql` | Delete |
| `example/import/prod_loader.sql` | Delete |

## Testing

- Unit tests for `findTargetTable`, `findImportProcedure`, `buildImportPlan` in `packages/db/spec/`
- Update `design.spec.js` in `packages/cli/spec/` — `organizeImports` → plan-based assertions
- Verify dry-run output includes both `\copy` and `call` lines
- Verify warning surfaced when procedure is absent
