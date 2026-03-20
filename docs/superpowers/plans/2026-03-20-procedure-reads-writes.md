# Procedure Read/Write Classification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tableReferences: string[]` on parsed procedures with `reads: string[]` and `writes: string[]`, and use `reads` to match import procedures to staging tables instead of the current naming convention.

**Architecture:** Two-pass change — (1) parser layer produces classified refs, (2) import plan layer consumes them. Tasks are ordered so each produces a green test suite before the next begins.

**Tech Stack:** Vitest, Bun, pgsql-parser, ES6 modules

---

## Chunk 1: Parser changes

### Task 1: Update `extractTableReferencesFromBody` and `extractBodyReferencesFromAst` to return `{ reads, writes }`

**Files:**

- Modify: `packages/postgres/src/parser/extractors/procedures.js`
- Test: `packages/postgres/spec/parser/procedure.spec.js` (unskip + rewrite the skipped test)
- Test: `packages/postgres/spec/parser/functional/procedures.spec.js:221`
- Test: `packages/postgres/spec/parser/parser-utils.spec.js:111`
- Test: `packages/postgres/spec/parser/functional/index.spec.js:145`
- Test: `packages/postgres/spec/parser/ddl-analyzer.spec.js:190-192`

**Context:**

- `extractTableReferencesFromBody(body)` is the regex path used for PL/pgSQL procedures (when `stmt.as` is present). It currently returns `string[]`.
- `extractBodyReferencesFromAst(stmt)` is the AST path for SQL functions (when `stmt.as` is absent). It is read-only, so `writes` is always `[]`.
- `procDefFromStatement` chooses between the two paths and currently assigns the result to `tableReferences`. After the change it will spread `reads`/`writes` directly onto the entity.
- `extractRoutinesFromSql` (regex fallback path) also calls `extractTableReferencesFromBody` and assigns to `tableReferences` — this must be changed to spread.
- Classification in `extractTableReferencesFromBody` is by matched keyword (already captured in `match[1]`):
  - reads: `FROM`, `JOIN`
  - writes: `INSERT INTO`, `UPDATE`, `DELETE FROM`, `ALTER TABLE`, `CREATE TABLE`

- [ ] **Step 1: Write a failing unit test for `extractTableReferencesFromBody`**

Add to `packages/postgres/spec/parser/procedure.spec.js` (import `extractTableReferencesFromBody` at top if not already imported):

```js
import { extractTableReferencesFromBody } from '../../../src/parser/extractors/procedures.js'

describe('extractTableReferencesFromBody', () => {
  it('classifies reads and writes from a mixed body', () => {
    const body = `
      BEGIN
        INSERT INTO table1 SELECT * FROM table2;
        UPDATE table3 SET col = 'value';
        DELETE FROM table4;
      END;
    `
    const result = extractTableReferencesFromBody(body)
    expect(result).toEqual({ reads: expect.any(Array), writes: expect.any(Array) })
    expect(result.reads).toContain('table2')
    expect(result.writes).toContain('table1')
    expect(result.writes).toContain('table3')
    expect(result.writes).toContain('table4')
    expect(result.reads).not.toContain('table1')
  })

  it('returns reads-only when body has only SELECT/FROM/JOIN', () => {
    const body = `
      BEGIN
        SELECT * FROM config.lookups JOIN staging.data ON true;
      END;
    `
    const result = extractTableReferencesFromBody(body)
    expect(result.reads).toContain('config.lookups')
    expect(result.reads).toContain('staging.data')
    expect(result.writes).toEqual([])
  })

  it('returns writes-only when body has only INSERT/UPDATE/DELETE', () => {
    const body = `
      BEGIN
        INSERT INTO config.lookups VALUES (1, 'a');
        UPDATE config.lookups SET name = 'b';
      END;
    `
    const result = extractTableReferencesFromBody(body)
    expect(result.reads).toEqual([])
    expect(result.writes).toContain('config.lookups')
  })

  it('returns empty reads and writes for empty body', () => {
    const result = extractTableReferencesFromBody('')
    expect(result).toEqual({ reads: [], writes: [] })
  })

  it('INSERT with subquery: target in writes, source in reads', () => {
    const body = `
      BEGIN
        INSERT INTO config.lookups SELECT id, name FROM staging.lookups;
      END;
    `
    const result = extractTableReferencesFromBody(body)
    expect(result.writes).toContain('config.lookups')
    expect(result.reads).toContain('staging.lookups')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test:postgres 2>&1 | grep -E "FAIL|PASS|extractTableReferencesFromBody"
```

Expected: FAIL — `result` is an array, not `{ reads, writes }`.

- [ ] **Step 3: Update `extractTableReferencesFromBody` to return `{ reads, writes }`**

In `packages/postgres/src/parser/extractors/procedures.js`, replace the function body (lines 253-294):

```js
export const extractTableReferencesFromBody = (body) => {
  if (!body || typeof body !== 'string') return { reads: [], writes: [] }

  const cleanBody = body
    .replace(/--[^\n]*(\n|$)/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^']*'/g, "''")

  const reads = new Set()
  const writes = new Set()

  const sqlKeywords = [
    'INSERT INTO',
    'DELETE FROM',
    'ALTER TABLE',
    'CREATE TABLE',
    'FROM',
    'JOIN',
    'UPDATE'
  ]

  const pattern = new RegExp(`(${sqlKeywords.join('|')})\\s+([\\w"\\.]+)`, 'gi')

  const nonTableWords =
    /^(SELECT|WHERE|GROUP|ORDER|HAVING|UNION|AND|OR|AS|SET|STRICT|NEW|OLD|IF|THEN|ELSE|ELSIF|END|LOOP|RETURN|RAISE|PERFORM|EXECUTE|DECLARE|BEGIN|EXCEPTION|FOUND|NULL|TRUE|FALSE|NOT|IS|IN|EXISTS|CASE|WHEN|USING|WITH)$/i

  const writeKeywords = /^(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|CREATE TABLE)$/i

  let match
  while ((match = pattern.exec(cleanBody)) !== null) {
    const keyword = match[1]
    const potentialTable = match[2].replace(/"/g, '')

    if (potentialTable && !nonTableWords.test(potentialTable.split('.').pop())) {
      if (writeKeywords.test(keyword)) {
        writes.add(potentialTable)
      } else {
        reads.add(potentialTable)
      }
    }
  }

  return { reads: Array.from(reads), writes: Array.from(writes) }
}
```

- [ ] **Step 4: Update `extractBodyReferencesFromAst` to return `{ reads, writes }`**

In the same file, replace the early returns and final return in `extractBodyReferencesFromAst`:

```js
// Replace: return []   (two occurrences near top of function)
// With:    return { reads: [], writes: [] }

// Replace: return Array.from(tables)   (at end of function)
// With:    return { reads: Array.from(tables), writes: [] }
```

- [ ] **Step 5: Update `procDefFromStatement` to spread `reads`/`writes` instead of assigning `tableReferences`**

```js
// Before:
const tableReferences = body
  ? extractTableReferencesFromBody(body)
  : extractBodyReferencesFromAst(stmt)

return {
  name: procedureName,
  schema: schema,
  replace: isReplace,
  language: extractProcedureLanguage(stmt),
  parameters: extractProcedureParameters(stmt),
  returnType: extractProcedureReturnType(stmt),
  body: body,
  tableReferences
}

// After:
const { reads, writes } = body
  ? extractTableReferencesFromBody(body)
  : extractBodyReferencesFromAst(stmt)

return {
  name: procedureName,
  schema: schema,
  replace: isReplace,
  language: extractProcedureLanguage(stmt),
  parameters: extractProcedureParameters(stmt),
  returnType: extractProcedureReturnType(stmt),
  body: body,
  reads,
  writes
}
```

- [ ] **Step 6: Update `extractRoutinesFromSql` to spread `reads`/`writes`**

```js
// Before:
procedures.push({
  name: procName,
  schema,
  replace: isReplace,
  language,
  parameters,
  returnType,
  body,
  tableReferences: extractTableReferencesFromBody(body)
})

// After:
procedures.push({
  name: procName,
  schema,
  replace: isReplace,
  language,
  parameters,
  returnType,
  body,
  ...extractTableReferencesFromBody(body)
})
```

- [ ] **Step 7: Fix existing tests that use `tableReferences`**

**`packages/postgres/spec/parser/procedure.spec.js` (lines 178-203):**
Remove the entire `it.skip('should extract table references from procedure body', ...)` block (replaced by new tests above).

**`packages/postgres/spec/parser/functional/procedures.spec.js` (line 221):**

```js
// Before:
expect(procedures[0].tableReferences).toContain('orders')
// After:
expect(procedures[0].reads).toContain('orders')
```

**`packages/postgres/spec/parser/parser-utils.spec.js` (line 111):**

```js
// Before:
expect(procedures[0].tableReferences).toContain('information_schema.columns')
// After:
expect(procedures[0].reads).toContain('information_schema.columns')
```

**`packages/postgres/spec/parser/functional/index.spec.js` (line 145):**

```js
// Before:
expect(procedures[0].tableReferences).toContain('products')
// After:
expect(procedures[0].reads).toContain('products')
```

**`packages/postgres/spec/parser/ddl-analyzer.spec.js` (lines 190-192):**

```js
// Before:
expect(importLookupsProc.tableReferences).toBeDefined()
expect(importLookupsProc.tableReferences).toContain('config.lookups')
expect(importLookupsProc.tableReferences).toContain('staging.lookups')

// After (import_lookups reads staging.lookups, writes config.lookups):
expect(importLookupsProc.reads).toBeDefined()
expect(importLookupsProc.reads).toContain('staging.lookups')
expect(importLookupsProc.writes).toContain('config.lookups')
```

- [ ] **Step 8: Run the postgres test suite**

```bash
bun run test:postgres
```

Expected: All tests pass, zero errors.

- [ ] **Step 9: Commit**

```bash
git add packages/postgres/src/parser/extractors/procedures.js \
        packages/postgres/spec/parser/procedure.spec.js \
        packages/postgres/spec/parser/functional/procedures.spec.js \
        packages/postgres/spec/parser/parser-utils.spec.js \
        packages/postgres/spec/parser/functional/index.spec.js \
        packages/postgres/spec/parser/ddl-analyzer.spec.js
git commit -m "feat(parser): classify procedure table refs as reads/writes instead of tableReferences"
```

---

### Task 2: Update `collectProcRefs` in `index-functional.js`

**Files:**

- Modify: `packages/postgres/src/parser/index-functional.js`
- Test: `packages/postgres/spec/parser/functional/dependencies.spec.js`

**Context:**

- `collectProcRefs` (line 179) feeds procedure table references into `refers` for the dependency graph.
- The test at line 245 is named `'handles procedure with no tableReferences property'` — rename it.
- The fixture test at line 478 uses `{ tableReferences: [...] }` — update to `{ reads: [...], writes: [...] }`.
- The dependency graph is directional-agnostic: a procedure depends on all referenced tables regardless of direction. `collectProcRefs` unions both.

- [ ] **Step 1: Update the fixture test at line 478**

```js
// Before:
it('collects procedure table references', () => {
  const refs = collectReferences({
    tables: [],
    views: [],
    procedures: [{ tableReferences: ['config.lookups', 'staging.data'] }],
    triggers: []
  })
  expect(refs).toHaveLength(2)
  expect(refs.map((r) => r.name)).toEqual(['config.lookups', 'staging.data'])
})

// After:
it('collects procedure table references from reads and writes', () => {
  const refs = collectReferences({
    tables: [],
    views: [],
    procedures: [{ reads: ['staging.data'], writes: ['config.lookups'] }],
    triggers: []
  })
  expect(refs).toHaveLength(2)
  expect(refs.map((r) => r.name)).toContain('config.lookups')
  expect(refs.map((r) => r.name)).toContain('staging.data')
})
```

Also rename the test at line 245:

```js
// Before:
it('handles procedure with no tableReferences property', () => {
// After:
it('handles procedure with no reads or writes properties', () => {
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test:postgres 2>&1 | grep -E "FAIL|collects procedure"
```

Expected: FAIL.

- [ ] **Step 3: Update `collectProcRefs` in `index-functional.js`**

```js
// Before:
const collectProcRefs = (procedures) => {
  const refs = []
  for (const proc of procedures) {
    for (const tableRef of proc.tableReferences || []) {
      refs.push({ name: tableRef, type: 'table/view' })
    }
  }
  return refs
}

// After:
const collectProcRefs = (procedures) => {
  const refs = []
  for (const proc of procedures) {
    for (const tableRef of [...(proc.reads ?? []), ...(proc.writes ?? [])]) {
      refs.push({ name: tableRef, type: 'table/view' })
    }
  }
  return refs
}
```

- [ ] **Step 4: Run postgres tests**

```bash
bun run test:postgres
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/postgres/src/parser/index-functional.js \
        packages/postgres/spec/parser/functional/dependencies.spec.js
git commit -m "feat(parser): collectProcRefs unions reads and writes for dependency graph"
```

---

## Chunk 2: Import plan changes

### Task 3: Update `findImportProcedure` and `buildImportPlan` in `entity-processor.js`

**Files:**

- Modify: `packages/db/src/entity-processor.js`
- Test: `packages/db/spec/entity-processor.spec.js`

**Context:**

- `findImportProcedure` currently finds a procedure by naming convention (`staging.import_<base_name>`). After the change it matches the first procedure whose `reads` array includes `importTable.name`.
- `buildImportPlan` gains a `targets` field: the non-staging tables the procedure writes to.
  - `stagingSchemas` is derived from `importTables.map(t => t.name.split('.')[0])` — no signature change.
  - `targets` is `procedure.writes.filter(name => !stagingSchemas.includes(name.split('.')[0]))`.
  - When no procedure matched, `targets` is `[]`.
- The existing `findTargetTable` and ordering logic are unchanged.

- [ ] **Step 1: Replace the `findImportProcedure` test block**

In `packages/db/spec/entity-processor.spec.js`, replace the `describe('findImportProcedure', ...)` block:

```js
describe('findImportProcedure', () => {
  const entities = [
    {
      type: 'procedure',
      name: 'staging.import_lookups',
      schema: 'staging',
      reads: ['staging.lookups'],
      writes: ['config.lookups'],
      refers: []
    },
    { type: 'table', name: 'config.lookups', schema: 'config', refers: [] }
  ]

  it('finds procedure that reads from the staging table', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    const result = findImportProcedure(importTable, entities)
    expect(result).not.toBeNull()
    expect(result.name).toBe('staging.import_lookups')
  })

  it('returns null when no procedure reads from the table', () => {
    const importTable = { name: 'staging.dev_fixtures', schema: 'staging' }
    const result = findImportProcedure(importTable, entities)
    expect(result).toBeNull()
  })

  it('does not match non-procedure entities even if they have reads', () => {
    const importTable = { name: 'staging.lookups', schema: 'staging' }
    const result = findImportProcedure(importTable, [
      { type: 'table', name: 'staging.import_lookups', reads: ['staging.lookups'] }
    ])
    expect(result).toBeNull()
  })

  it('returns first match when multiple procedures read from same table', () => {
    const multi = [
      {
        type: 'procedure',
        name: 'staging.import_a',
        reads: ['staging.lookups'],
        writes: ['config.lookups']
      },
      {
        type: 'procedure',
        name: 'staging.import_b',
        reads: ['staging.lookups'],
        writes: ['audit.lookups']
      }
    ]
    const result = findImportProcedure({ name: 'staging.lookups' }, multi)
    expect(result.name).toBe('staging.import_a')
  })
})
```

- [ ] **Step 2: Replace the `buildImportPlan` test block**

Replace the `describe('buildImportPlan', ...)` block (with updated fixtures and new `targets` tests):

```js
describe('buildImportPlan', () => {
  const entities = [
    { type: 'table', name: 'config.lookups', schema: 'config', refers: [] },
    { type: 'table', name: 'config.lookup_values', schema: 'config', refers: ['config.lookups'] },
    { type: 'table', name: 'staging.lookups', schema: 'staging', refers: [] },
    { type: 'table', name: 'staging.lookup_values', schema: 'staging', refers: [] },
    {
      type: 'procedure',
      name: 'staging.import_lookups',
      schema: 'staging',
      reads: ['staging.lookups'],
      writes: ['config.lookups'],
      refers: []
    },
    {
      type: 'procedure',
      name: 'staging.import_lookup_values',
      schema: 'staging',
      reads: ['staging.lookup_values'],
      writes: ['config.lookup_values'],
      refers: []
    }
  ]

  const importTables = [
    { name: 'staging.lookup_values', schema: 'staging', file: 'import/staging/lookup_values.csv' },
    { name: 'staging.lookups', schema: 'staging', file: 'import/staging/lookups.csv' }
  ]

  it('returns one entry per import table', () => {
    const plan = buildImportPlan(importTables, entities)
    expect(plan).toHaveLength(2)
  })

  it('each entry has table, targetTable, procedure, targets, and warnings fields', () => {
    const plan = buildImportPlan(importTables, entities)
    for (const entry of plan) {
      expect(entry).toHaveProperty('table')
      expect(entry).toHaveProperty('targetTable')
      expect(entry).toHaveProperty('procedure')
      expect(entry).toHaveProperty('targets')
      expect(entry).toHaveProperty('warnings')
      expect(Array.isArray(entry.warnings)).toBe(true)
      expect(Array.isArray(entry.targets)).toBe(true)
    }
  })

  it('orders staging.lookups before staging.lookup_values (dependency order)', () => {
    const plan = buildImportPlan(importTables, entities)
    const names = plan.map((e) => e.table.name)
    expect(names.indexOf('staging.lookups')).toBeLessThan(names.indexOf('staging.lookup_values'))
  })

  it('attaches the matched procedure to each entry via reads-based matching', () => {
    const plan = buildImportPlan(importTables, entities)
    const lookupsEntry = plan.find((e) => e.table.name === 'staging.lookups')
    expect(lookupsEntry.procedure?.name).toBe('staging.import_lookups')
    expect(lookupsEntry.warnings).toEqual([])
  })

  it('targets contains non-staging writes of matched procedure', () => {
    const plan = buildImportPlan(importTables, entities)
    const lookupsEntry = plan.find((e) => e.table.name === 'staging.lookups')
    expect(lookupsEntry.targets).toContain('config.lookups')
  })

  it('targets excludes staging-schema writes', () => {
    const withStagingWrite = [
      ...entities.slice(0, 4),
      {
        type: 'procedure',
        name: 'staging.import_lookups',
        schema: 'staging',
        reads: ['staging.lookups'],
        writes: ['staging.temp', 'config.lookups'],
        refers: []
      }
    ]
    const plan = buildImportPlan(
      [{ name: 'staging.lookups', schema: 'staging', file: 'import/staging/lookups.csv' }],
      withStagingWrite
    )
    expect(plan[0].targets).toContain('config.lookups')
    expect(plan[0].targets).not.toContain('staging.temp')
  })

  it('targets is empty array when no procedure matched', () => {
    const noProc = [
      { name: 'staging.dev_fixtures', schema: 'staging', file: 'import/staging/dev_fixtures.csv' }
    ]
    const plan = buildImportPlan(noProc, entities)
    expect(plan[0].procedure).toBeNull()
    expect(plan[0].targets).toEqual([])
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

- [ ] **Step 3: Run to verify the new tests fail**

```bash
bun run test:db 2>&1 | grep -E "FAIL|findImportProcedure|targets"
```

Expected: FAIL on reads-based matching and `targets` tests.

- [ ] **Step 4: Update `findImportProcedure` to use reads-based matching**

In `packages/db/src/entity-processor.js`:

```js
// Before:
export function findImportProcedure(importTable, entities) {
  const [schema, baseName] = importTable.name.split('.')
  const procedureName = `${schema}.import_${baseName}`
  return entities.find((e) => e.type === 'procedure' && e.name === procedureName) ?? null
}

// After:
export function findImportProcedure(importTable, entities) {
  return (
    entities.find((e) => e.type === 'procedure' && (e.reads ?? []).includes(importTable.name)) ??
    null
  )
}
```

- [ ] **Step 5: Update `buildImportPlan` to add `targets` field**

```js
// Before:
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

// After:
export function buildImportPlan(importTables, entities) {
  const tables = entities.filter((e) => e.type === 'table')
  const stagingSchemas = [...new Set(importTables.map((t) => t.name.split('.')[0]))]

  return importTables
    .map((table) => {
      const targetTable = findTargetTable(table, entities)
      const procedure = findImportProcedure(table, entities)
      const warnings = procedure ? [] : [`no import procedure for ${table.name}`]
      const targets = procedure
        ? (procedure.writes ?? []).filter((name) => !stagingSchemas.includes(name.split('.')[0]))
        : []
      const order = targetTable ? tables.findIndex((t) => t.name === targetTable.name) : Infinity
      return { table, targetTable, procedure, targets, warnings, order }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...entry }) => entry)
}
```

- [ ] **Step 6: Run db tests**

```bash
bun run test:db
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/entity-processor.js \
        packages/db/spec/entity-processor.spec.js
git commit -m "feat(db): match import procedures by reads, add targets to import plan entries"
```

---

### Task 4: Update `importTables` getter in `design.js` to forward `targets`

**Files:**

- Modify: `packages/cli/src/design.js`
- Test: `packages/cli/spec/design.spec.js`

**Context:**

- The `importTables` getter at line 83 currently destructures `{ table, procedure, warnings: planWarnings }`. It must also destructure `targets`.
- `design.spec.js` has no existing `targets` assertions. We add one test to confirm `targets` passes through as an array on every import table entry.

- [ ] **Step 1: Write a failing test confirming `targets` is forwarded**

In `packages/cli/spec/design.spec.js`, add near the existing `importTables` tests (around line 293):

```js
it('importTables entries have a targets array', async () => {
  const dx = await loadDesign('default')
  for (const table of dx.importTables) {
    expect(table).toHaveProperty('targets')
    expect(Array.isArray(table.targets)).toBe(true)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test:cli 2>&1 | grep -E "FAIL|targets"
```

Expected: FAIL — `targets` is undefined on the import table entry.

- [ ] **Step 3: Update `importTables` getter in `design.js`**

```js
// Before:
get importTables() {
	return this.#importTables.map(({ table, procedure, warnings: planWarnings }) => ({
		...table,
		procedure,
		warnings: [...(table.warnings || []), ...planWarnings]
	}))
}

// After:
get importTables() {
	return this.#importTables.map(({ table, procedure, targets, warnings: planWarnings }) => ({
		...table,
		procedure,
		targets,
		warnings: [...(table.warnings || []), ...planWarnings]
	}))
}
```

- [ ] **Step 4: Run cli tests**

```bash
bun run test:cli
```

Expected: All pass.

- [ ] **Step 5: Run full test suite**

```bash
bun run test
```

Expected: All pass, zero errors.

- [ ] **Step 6: Run lint**

```bash
bun run lint
```

Expected: Zero errors (pre-existing warnings acceptable).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/design.js \
        packages/cli/spec/design.spec.js
git commit -m "feat(cli): forward targets from import plan through importTables getter"
```

---

## Final Step: Update plan and journal

- [ ] Update `agents/plan.md` — mark procedure reads/writes plan complete
- [ ] Update `agents/journal.md` — log what was done with commit hashes
