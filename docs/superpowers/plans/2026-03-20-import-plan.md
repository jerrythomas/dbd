# Auto-sequenced Import Plan Implementation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manually maintained `loader.sql` with automatic import procedure detection and dependency-ordered execution.

**Architecture:** Add three pure functions (`findTargetTable`, `findImportProcedure`, `buildImportPlan`) to `entity-processor.js`. Replace `organizeImports()` in `design.js` with a call to `buildImportPlan()`. The plan drives `importData()` — CSV load then procedure call per table, in dependency order. Procedure warnings surface through the existing `report()` / `inspect` mechanism.

**Tech Stack:** Node.js ES Modules, Vitest, Ramda (none needed for new functions — plain JS)

**Spec:** `docs/superpowers/specs/2026-03-20-import-plan-design.md`

---

## Chunk 1: Pure Functions

### Task 1: Failing tests for `findTargetTable` and `findImportProcedure`

**Files:**

- Modify: `packages/db/spec/entity-processor.spec.js` (add new describe block at end of file)

These tests use inline fixtures — no file system needed.

- [ ] **Step 1: Add failing tests**

Add a new describe block at the end of `packages/db/spec/entity-processor.spec.js`, before the final closing `})`:

```js
// --- buildImportPlan helpers ---

describe('findTargetTable', () => {
  const entities = [
    { type: 'table', name: 'config.lookups', schema: 'config', refers: [] },
    { type: 'table', name: 'config.lookup_values', schema: 'config', refers: ['config.lookups'] },
    { type: 'table', name: 'staging.lookups', schema: 'staging', refers: [] },
    { type: 'procedure', name: 'staging.import_lookups', schema: 'staging', refers: [] }
  ]

  it('finds target table by base name in non-staging schema', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    const result = findTargetTable(importTable, entities)
    expect(result).not.toBeNull()
    expect(result.name).toBe('config.lookups')
  })

  it('returns null when no target table exists', () => {
    const importTable = { name: 'staging.dev_fixtures', schema: 'staging' }
    const result = findTargetTable(importTable, entities)
    expect(result).toBeNull()
  })

  it('does not match staging tables in the same schema', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    const result = findTargetTable(importTable, entities)
    expect(result?.schema).not.toBe('staging')
  })
})

describe('findImportProcedure', () => {
  const entities = [
    { type: 'procedure', name: 'staging.import_lookups', schema: 'staging', refers: [] },
    { type: 'table', name: 'config.lookups', schema: 'config', refers: [] }
  ]

  it('finds procedure matching staging.import_{base_name}', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    const result = findImportProcedure(importTable, entities)
    expect(result).not.toBeNull()
    expect(result.name).toBe('staging.import_lookups')
  })

  it('returns null when no procedure exists', () => {
    const importTable = { name: 'staging.dev_fixtures', schema: 'staging' }
    const result = findImportProcedure(importTable, entities)
    expect(result).toBeNull()
  })

  it('does not match non-procedure entities', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    // only tables available, no procedures
    const result = findImportProcedure(importTable, [
      { type: 'table', name: 'staging.import_lookups', schema: 'staging' }
    ])
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Add imports for the new functions**

At the top of `packages/db/spec/entity-processor.spec.js`, add `findTargetTable` and `findImportProcedure` to the import:

```js
import {
  // ... existing imports ...
  findTargetTable,
  findImportProcedure,
  buildImportPlan
} from '../src/entity-processor.js'
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun run test:db 2>&1 | grep -A3 "findTargetTable\|findImportProcedure\|Cannot find"
```

Expected: FAIL — `findTargetTable is not a function` (or similar import error)

---

### Task 2: Implement `findTargetTable` and `findImportProcedure`

**Files:**

- Modify: `packages/db/src/entity-processor.js` (add after `organizeEntities`)

- [ ] **Step 1: Add implementations**

Add after the `organizeEntities` function in `packages/db/src/entity-processor.js`:

```js
// --- Import plan ---

/**
 * Find the target table for a staging import table by matching base name across schemas.
 * e.g. staging.lookups → config.lookups
 *
 * @param {{ name: string, schema: string }} importTable
 * @param {Array} entities
 * @returns {Object|null}
 */
export function findTargetTable(importTable, entities) {
  const baseName = importTable.name.split('.')[1]
  return (
    entities.find(
      (e) =>
        e.type === 'table' && e.name.split('.')[1] === baseName && e.schema !== importTable.schema
    ) ?? null
  )
}

/**
 * Find the import procedure for a staging import table by naming convention.
 * e.g. staging.lookups → staging.import_lookups
 *
 * @param {{ name: string }} importTable
 * @param {Array} entities
 * @returns {Object|null}
 */
export function findImportProcedure(importTable, entities) {
  const [schema, baseName] = importTable.name.split('.')
  const procedureName = `${schema}.import_${baseName}`
  return entities.find((e) => e.type === 'procedure' && e.name === procedureName) ?? null
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
bun run test:db 2>&1 | grep -E "findTargetTable|findImportProcedure|PASS|FAIL"
```

Expected: both describe blocks PASS

---

### Task 3: Failing tests for `buildImportPlan`

**Files:**

- Modify: `packages/db/spec/entity-processor.spec.js` (add describe block after findImportProcedure tests)

- [ ] **Step 1: Add failing tests**

```js
describe('buildImportPlan', () => {
  const entities = [
    { type: 'table', name: 'config.lookups', schema: 'config', refers: [] },
    { type: 'table', name: 'config.lookup_values', schema: 'config', refers: ['config.lookups'] },
    { type: 'table', name: 'staging.lookups', schema: 'staging', refers: [] },
    { type: 'table', name: 'staging.lookup_values', schema: 'staging', refers: [] },
    { type: 'procedure', name: 'staging.import_lookups', schema: 'staging', refers: [] },
    { type: 'procedure', name: 'staging.import_lookup_values', schema: 'staging', refers: [] }
  ]

  const importTables = [
    { name: 'staging.lookup_values', schema: 'staging', file: 'import/staging/lookup_values.csv' },
    { name: 'staging.lookups', schema: 'staging', file: 'import/staging/lookups.csv' }
  ]

  it('returns one entry per import table', () => {
    const plan = buildImportPlan(importTables, entities)
    expect(plan).toHaveLength(2)
  })

  it('each entry has table, targetTable, procedure, and warnings fields', () => {
    const plan = buildImportPlan(importTables, entities)
    for (const entry of plan) {
      expect(entry).toHaveProperty('table')
      expect(entry).toHaveProperty('targetTable')
      expect(entry).toHaveProperty('procedure')
      expect(entry).toHaveProperty('warnings')
    }
  })

  it('orders staging.lookups before staging.lookup_values (dependency order)', () => {
    const plan = buildImportPlan(importTables, entities)
    const names = plan.map((e) => e.table.name)
    expect(names.indexOf('staging.lookups')).toBeLessThan(names.indexOf('staging.lookup_values'))
  })

  it('attaches the matched procedure to each entry', () => {
    const plan = buildImportPlan(importTables, entities)
    const lookupsEntry = plan.find((e) => e.table.name === 'staging.lookups')
    expect(lookupsEntry.procedure?.name).toBe('staging.import_lookups')
  })

  it('attaches null procedure and a warning when no procedure exists', () => {
    const noProc = [
      { name: 'staging.dev_fixtures', schema: 'staging', file: 'import/staging/dev_fixtures.csv' }
    ]
    const plan = buildImportPlan(noProc, entities)
    expect(plan[0].procedure).toBeNull()
    expect(plan[0].warnings).toContain('no import procedure for staging.dev_fixtures')
  })

  it('tables with no matching target go last', () => {
    const mixed = [
      { name: 'staging.dev_fixtures', schema: 'staging', file: 'import/staging/dev_fixtures.csv' },
      { name: 'staging.lookups', schema: 'staging', file: 'import/staging/lookups.csv' }
    ]
    const plan = buildImportPlan(mixed, entities)
    const names = plan.map((e) => e.table.name)
    expect(names.indexOf('staging.lookups')).toBeLessThan(names.indexOf('staging.dev_fixtures'))
  })

  it('returns empty array for empty importTables', () => {
    expect(buildImportPlan([], entities)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:db 2>&1 | grep -A3 "buildImportPlan\|Cannot find"
```

Expected: FAIL — `buildImportPlan is not a function`

---

### Task 4: Implement `buildImportPlan`

**Files:**

- Modify: `packages/db/src/entity-processor.js` (add after `findImportProcedure`)

- [ ] **Step 1: Add implementation**

Add after `findImportProcedure` in `packages/db/src/entity-processor.js`:

```js
/**
 * Build an ordered import plan connecting each staging table to its target table
 * and import procedure. Sorted by target table position in the dependency graph
 * (tables without a matched target go last).
 *
 * @param {Array} importTables - staging import table entities
 * @param {Array} entities - all project entities (tables, procedures, etc.)
 * @returns {Array<{ table, targetTable, procedure, warnings }>}
 */
export function buildImportPlan(importTables, entities) {
  const tables = entities.filter((e) => e.type === 'table')

  return importTables
    .map((table) => {
      const targetTable = findTargetTable(table, entities)
      const procedure = findImportProcedure(table, entities)
      const warnings = procedure ? [] : [`no import procedure for ${table.name}`]
      const order = targetTable ? tables.findIndex((t) => t.name === targetTable.name) : Infinity
      return { table, targetTable, procedure, warnings, order }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...entry }) => entry)
}
```

- [ ] **Step 2: Export from `packages/db/src/index.js`**

Add to the entity-processor exports in `packages/db/src/index.js`:

```js
export {
  // ... existing exports ...
  findTargetTable,
  findImportProcedure,
  buildImportPlan
} from './entity-processor.js'
```

- [ ] **Step 3: Run tests to confirm all pass**

```bash
bun run test:db
```

Expected: all db tests pass, 0 failures

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/entity-processor.js packages/db/src/index.js packages/db/spec/entity-processor.spec.js
git commit -m "feat(db): add findTargetTable, findImportProcedure, buildImportPlan pure functions"
```

---

## Chunk 2: Design Class + Test Updates

### Task 5: Update `design.js` — replace `organizeImports` with `buildImportPlan`

**Files:**

- Modify: `packages/cli/src/design.js`

The internal `#importTables` field now stores plan entries `[{ table, targetTable, procedure, warnings }]`.
The `importTables` getter returns a flat view: `[{ ...table, procedure }]` with plan warnings merged into `table.warnings`. This keeps existing test surface area largely intact (tests still access `t.name`, `t.schema`), while adding `t.procedure` for the import loop.

- [ ] **Step 1: Update imports in `design.js`**

Replace the `sortByDependencies` import line to add `buildImportPlan`:

```js
import {
  entityFromSchemaName,
  entityFromExportConfig,
  entityFromExtensionConfig,
  ddlFromEntity,
  validateEntity,
  importScriptForEntity,
  exportScriptForEntity,
  filterEntitiesForDBML,
  sortByDependencies,
  buildImportPlan,
  graphFromEntities
} from '@jerrythomas/dbd-db'
```

- [ ] **Step 2: Replace `organizeImports` with `buildImportPlan` in constructor**

In the `Design` constructor, change:

```js
this.#importTables = this.organizeImports(config.importTables)
```

to:

```js
this.#importTables = buildImportPlan(config.importTables, config.entities)
```

- [ ] **Step 3: Update `importTables` getter to return flat view**

The getter should flatten plan entries so existing callers (`t.name`, `t.schema`, etc.) still work, while merging plan warnings into table warnings and exposing `procedure`:

```js
get importTables() {
  return this.#importTables.map(({ table, procedure, warnings: planWarnings }) => ({
    ...table,
    procedure,
    warnings: [...(table.warnings || []), ...planWarnings]
  }))
}
```

- [ ] **Step 4: Remove `organizeImports` method**

Delete the entire `organizeImports(importTables) { ... }` method from the `Design` class.

- [ ] **Step 5: Run tests to see what breaks**

```bash
bun run test:cli 2>&1 | grep -E "FAIL|✗|Error" | head -20
```

Note which tests fail — expected failures are the `order` test, the dry-run table object test, and the `executeFile(loader.sql)` test.

---

### Task 6: Update `validate()` in `design.js`

**Files:**

- Modify: `packages/cli/src/design.js`

`validate()` currently maps over `this.importTables` (flat objects). After Step 5 above it maps over plan entries stored in `#importTables`. We need to validate `entry.table` and write back validated entries.

- [ ] **Step 1: Replace the validate importTables block**

Find and replace the block that validates import tables:

```js
// Old:
this.#importTables = this.importTables
  .filter((entity) => entity.env === null || entity.env === this.#env)
  .map((entity) => validateEntity(entity, false))
  .map((entity) => {
    if (!allowedSchemas.includes(entity.schema))
      entity.errors = [...(entity.errors || []), 'Import is only allowed for staging schemas']
    return entity
  })

// New:
this.#importTables = this.#importTables
  .filter(({ table }) => table.env === null || table.env === this.#env)
  .map((entry) => ({ ...entry, table: validateEntity(entry.table, false) }))
  .map((entry) => {
    if (!allowedSchemas.includes(entry.table.schema)) {
      return {
        ...entry,
        table: {
          ...entry.table,
          errors: [...(entry.table.errors || []), 'Import is only allowed for staging schemas']
        }
      }
    }
    return entry
  })
```

---

### Task 7: Update `importData()` in `design.js`

**Files:**

- Modify: `packages/cli/src/design.js`

`importData()` now iterates plan entries. For each: load CSV, call procedure if present, warn if missing.
Remove the `import.after` file execution (loader.sql is gone).

- [ ] **Step 1: Replace `importData()` method**

```js
async importData(name, dryRun = false) {
  if (!this.isValidated) this.validate()

  const plan = this.importTables
    .filter((table) => !table.errors || table.errors.length === 0)
    .filter((table) => !name || table.name === name || table.file === name)

  if (dryRun) {
    for (const table of plan) {
      console.info(`Importing ${table.name}`)
      table.warnings.forEach((w) => console.warn(w))
      console.info(importScriptForEntity(table))
      if (table.procedure) console.info(`call ${table.procedure.name}();`)
    }
    return this
  }

  const adapter = await this.getAdapter()
  for (const table of plan) {
    console.info(`Importing ${table.name}`)
    table.warnings.forEach((w) => console.warn(w))
    await adapter.importData(table)
    if (table.procedure) {
      console.info(`Calling ${table.procedure.name}`)
      await adapter.executeScript(`call ${table.procedure.name}();`)
    }
  }

  const sharedAfter = this.config.import.after ?? []
  const envAfter = this.config.import[`after.${this.#env}`] ?? []
  for (const file of [...sharedAfter, ...envAfter]) {
    console.info(`Processing ${file}`)
    await adapter.executeFile(file)
  }

  return this
}
```

Note: `import.after` is kept for any non-procedure post-import SQL users may still configure. It just won't be used for procedure calls in new projects.

- [ ] **Step 2: Run cli tests to see current state**

```bash
bun run test:cli 2>&1 | grep -E "FAIL|✗|pass|fail" | head -20
```

---

### Task 8: Update broken tests in `design.spec.js`

**Files:**

- Modify: `packages/cli/spec/design.spec.js`

Three groups of tests need updating:

**Group A — `importTables` ordering test (line ~283)**

- [ ] **Step 1: Replace the `order` field test**

The old test checked an `order` field that no longer exists. Replace with a test that verifies `staging.lookups` comes before `staging.lookup_values` in the plan:

```js
// Old:
it('importTables are ordered by entity index', async () => {
  const dx = await using('design.yaml')
  const orders = dx.importTables.map((t) => t.order)
  const sorted = [...orders].sort((a, b) => a - b)
  expect(orders).toEqual(sorted)
})

// New:
it('importTables are ordered by target table dependency', async () => {
  const dx = await using('design.yaml')
  const names = dx.importTables.map((t) => t.name)
  const lookupsIdx = names.indexOf('staging.lookups')
  const lookupValuesIdx = names.indexOf('staging.lookup_values')
  // lookup_values depends on lookups — so lookups must come first
  if (lookupsIdx !== -1 && lookupValuesIdx !== -1) {
    expect(lookupsIdx).toBeLessThan(lookupValuesIdx)
  }
})
```

**Group B — dry-run table object test (line ~245)**

- [ ] **Step 2: Replace the "logs table object" dry-run test**

The new dry-run logs the `\copy` script string and the `call` statement, not the table object. Replace:

```js
// Old:
it('importData dry-run also logs the table object', async () => {
  const dx = await using('design.yaml')
  dx.importData('staging.lookups', true)

  const infoCalls = console.info.mock.calls.map((c) => c[0])
  const tableObj = infoCalls.find((c) => typeof c === 'object' && c.name === 'staging.lookups')
  expect(tableObj).toBeDefined()
  expect(tableObj).toHaveProperty('file')
})

// New:
it('importData dry-run logs the \\copy script for the table', async () => {
  const dx = await using('design.yaml')
  dx.importData('staging.lookups', true)

  const infoCalls = console.info.mock.calls.map((c) => c[0])
  const copyScript = infoCalls.find((c) => typeof c === 'string' && c.includes('\\copy'))
  expect(copyScript).toBeDefined()
  expect(copyScript).toContain('staging.lookups')
})

it('importData dry-run logs call statement when procedure exists', async () => {
  const dx = await using('design.yaml')
  dx.importData('staging.lookups', true)

  const infoCalls = console.info.mock.calls.map((c) => c[0])
  const callStatement = infoCalls.find(
    (c) => typeof c === 'string' && c.startsWith('call staging.import_lookups')
  )
  expect(callStatement).toBeDefined()
})
```

**Group C — non-dry-run `executeFile(loader.sql)` test (line ~355)**

- [ ] **Step 3: Replace the executeFile test**

`importData()` no longer calls `executeFile('import/loader.sql')`. It calls `executeScript(...)` for procedures instead:

```js
// Old:
it('importData() non-dry-run calls adapter.importData and executeFile', async () => {
  const dx = await using('design.yaml')
  const adapter = await dx.getAdapter()
  const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
  const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()

  await dx.importData()

  expect(importSpy).toHaveBeenCalled()
  expect(execSpy).toHaveBeenCalledWith('import/loader.sql')

  importSpy.mockRestore()
  execSpy.mockRestore()
})

// New:
it('importData() non-dry-run calls adapter.importData for each table', async () => {
  const dx = await using('design.yaml')
  const adapter = await dx.getAdapter()
  const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
  const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()

  await dx.importData()

  expect(importSpy).toHaveBeenCalled()
  importSpy.mockRestore()
  execScriptSpy.mockRestore()
})

it('importData() non-dry-run calls executeScript for each matched procedure', async () => {
  const dx = await using('design.yaml')
  const adapter = await dx.getAdapter()
  vi.spyOn(adapter, 'importData').mockResolvedValue()
  const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()

  await dx.importData()

  const procedureCalls = execScriptSpy.mock.calls
    .map((c) => c[0])
    .filter((s) => s.startsWith('call staging.import_'))
  expect(procedureCalls.length).toBeGreaterThan(0)

  vi.restoreAllMocks()
})
```

**Group D — env tests (lines ~527–580)**

- [ ] **Step 4: Update env tests to use `entry.table.name` → already flat via getter**

The `importTables` getter returns flat entries (Step 3 of Task 5), so `t.name` still works. Run tests to confirm these pass without changes:

```bash
bun run test:cli 2>&1 | grep -E "env|FAIL|✗" | head -20
```

If any env test fails due to the flat getter, access the name via `t.name` (should already work since getter spreads `...table`).

---

### Task 9: Run full test suite and fix any remaining failures

- [ ] **Step 1: Run all workspace tests**

```bash
bun run test
```

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: 0 errors. Fix any errors before continuing (warnings are pre-existing and acceptable).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): replace organizeImports with buildImportPlan, auto-call import procedures"
```

---

## Verification

After both chunks are complete:

```bash
# All tests pass
bun run test

# Lint clean
bun run lint

# Manual dry-run smoke test (from example/ dir)
cd example
dbd import --dry-run
# Expected output includes:
# Importing staging.lookups
# \copy staging.lookups from ...
# call staging.import_lookups();
# Importing staging.lookup_values
# \copy staging.lookup_values from ...
# call staging.import_lookup_values();
# [warning] no import procedure for staging.dev_fixture_table  (if applicable)

# Inspect smoke test
dbd inspect
# Expected: procedure warnings appear in Warnings section
```
