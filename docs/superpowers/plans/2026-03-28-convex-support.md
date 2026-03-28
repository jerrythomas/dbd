# Convex Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--target=convex` to `dbd apply` and `dbd import`, plus `dbd convex schema` / `dbd convex seed` subcommands, backed by a new `packages/convex` package that generates `convex/schema.ts` from parsed DDL entities and seeds data via `npx convex import`.

**Architecture:** New `packages/convex` (`@jerrythomas/dbd-convex`) provides three pure modules: `sql-type-map.js` (SQL type → Convex validator), `schema-generator.js` (entities → schema.ts content), and `data-seeder.js` (shell to `npx convex import`). The CLI `apply` and `importData` methods gain a `target` parameter that routes to the convex package when `target === 'convex'`. Postgres DDL parsing is unchanged. `execFileSync` with argument arrays is used throughout (avoids shell injection).

**Tech Stack:** Node.js ESM, Vitest, `child_process.execFileSync`, Convex CLI (`npx convex import`, `npx convex deploy`)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/convex/package.json` | Create | Package manifest for `@jerrythomas/dbd-convex` |
| `packages/convex/src/sql-type-map.js` | Create | SQL type string → `v.xxx()` validator string |
| `packages/convex/src/schema-generator.js` | Create | `generateSchemaTs(entities, config)` → schema.ts content + warnings |
| `packages/convex/src/data-seeder.js` | Create | `seedTable(table, config, isProd)` → shells `npx convex import` via `execFileSync` |
| `packages/convex/src/index.js` | Create | Re-exports for the package |
| `packages/convex/spec/sql-type-map.spec.js` | Create | Unit tests for type mapping |
| `packages/convex/spec/schema-generator.spec.js` | Create | Unit tests for schema generation |
| `packages/convex/spec/data-seeder.spec.js` | Create | Unit tests for seeder (mocked execFileSync) |
| `config/vitest.config.ts` | Modify | Add `convex` project |
| `package.json` (root) | Modify | Add `test:convex` script |
| `packages/cli/package.json` | Modify | Add `@jerrythomas/dbd-convex: workspace:*` dep |
| `packages/cli/src/design.js` | Modify | Add `target` param to `apply()` and `importData()` |
| `packages/cli/src/index.js` | Modify | Add `--target` to `apply`/`import`; add `convex schema`/`convex seed` commands |

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/convex/package.json`
- Create: `packages/convex/src/index.js`
- Modify: `config/vitest.config.ts`
- Modify: `package.json` (root)
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Create `packages/convex/package.json`**

```json
{
  "name": "@jerrythomas/dbd-convex",
  "version": "2.2.1",
  "description": "Convex schema generation and data seeding for DBD.",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  },
  "keywords": ["database", "convex", "schema", "seeding"],
  "repository": {
    "type": "git",
    "url": "https://github.com/jerrythomas/dbd"
  },
  "author": "Jerry Thomas <me@jerrythomas.name>",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {},
  "publishConfig": {
    "access": "public"
  },
  "exports": {
    ".": {
      "import": "./src/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

- [ ] **Step 2: Create `packages/convex/src/index.js`** (placeholder — filled out in Task 5)

```js
// exports added as modules are implemented
```

- [ ] **Step 3: Add `convex` project to `config/vitest.config.ts`**

In `config/vitest.config.ts`, add to the `projects` array after the `dbml` entry:

```ts
{ extends: true, test: { name: 'convex', root: resolve(__dirname, '../packages/convex') } }
```

- [ ] **Step 4: Add `test:convex` script to root `package.json`**

In the `"scripts"` block, add after `test:dbml`:

```json
"test:convex": "vitest run --config config/vitest.config.ts --project convex",
```

- [ ] **Step 5: Add `@jerrythomas/dbd-convex` to `packages/cli/package.json`**

In `packages/cli/package.json`, add to `"dependencies"`:

```json
"@jerrythomas/dbd-convex": "workspace:*",
```

- [ ] **Step 6: Install workspace dependencies**

```bash
bun install
```

Expected: installs and links `@jerrythomas/dbd-convex` into the workspace.

- [ ] **Step 7: Verify the package is visible**

```bash
bun run test:convex
```

Expected: no tests yet — output: `0 tests passed`.

- [ ] **Step 8: Commit**

```bash
git add packages/convex config/vitest.config.ts package.json packages/cli/package.json
git commit -m "chore(convex): scaffold @jerrythomas/dbd-convex package"
```

---

## Task 2: SQL type map

**Files:**
- Create: `packages/convex/src/sql-type-map.js`
- Create: `packages/convex/spec/sql-type-map.spec.js`

- [ ] **Step 1: Write failing tests**

Create `packages/convex/spec/sql-type-map.spec.js`:

```js
import { describe, it, expect } from 'vitest'
import { sqlTypeToConvex, columnToValidator } from '../src/sql-type-map.js'

describe('sqlTypeToConvex', () => {
  it('maps text types to v.string()', () => {
    expect(sqlTypeToConvex('text')).toBe('v.string()')
    expect(sqlTypeToConvex('varchar')).toBe('v.string()')
    expect(sqlTypeToConvex('varchar(255)')).toBe('v.string()')
    expect(sqlTypeToConvex('uuid')).toBe('v.string()')
    expect(sqlTypeToConvex('citext')).toBe('v.string()')
    expect(sqlTypeToConvex('name')).toBe('v.string()')
  })

  it('maps integer types to v.number()', () => {
    expect(sqlTypeToConvex('integer')).toBe('v.number()')
    expect(sqlTypeToConvex('int')).toBe('v.number()')
    expect(sqlTypeToConvex('int4')).toBe('v.number()')
    expect(sqlTypeToConvex('int8')).toBe('v.number()')
    expect(sqlTypeToConvex('bigint')).toBe('v.number()')
    expect(sqlTypeToConvex('serial')).toBe('v.number()')
    expect(sqlTypeToConvex('bigserial')).toBe('v.number()')
    expect(sqlTypeToConvex('smallint')).toBe('v.number()')
  })

  it('maps float/decimal types to v.number()', () => {
    expect(sqlTypeToConvex('float4')).toBe('v.number()')
    expect(sqlTypeToConvex('float8')).toBe('v.number()')
    expect(sqlTypeToConvex('numeric')).toBe('v.number()')
    expect(sqlTypeToConvex('numeric(10,2)')).toBe('v.number()')
    expect(sqlTypeToConvex('decimal')).toBe('v.number()')
    expect(sqlTypeToConvex('money')).toBe('v.number()')
    expect(sqlTypeToConvex('real')).toBe('v.number()')
  })

  it('maps boolean to v.boolean()', () => {
    expect(sqlTypeToConvex('boolean')).toBe('v.boolean()')
    expect(sqlTypeToConvex('bool')).toBe('v.boolean()')
  })

  it('maps json/jsonb to v.any()', () => {
    expect(sqlTypeToConvex('json')).toBe('v.any()')
    expect(sqlTypeToConvex('jsonb')).toBe('v.any()')
  })

  it('maps timestamp/date/time types to v.string()', () => {
    expect(sqlTypeToConvex('timestamp')).toBe('v.string()')
    expect(sqlTypeToConvex('timestamptz')).toBe('v.string()')
    expect(sqlTypeToConvex('date')).toBe('v.string()')
    expect(sqlTypeToConvex('time')).toBe('v.string()')
    expect(sqlTypeToConvex('timetz')).toBe('v.string()')
  })

  it('maps bytea to v.bytes()', () => {
    expect(sqlTypeToConvex('bytea')).toBe('v.bytes()')
  })

  it('maps array types to v.array(inner)', () => {
    expect(sqlTypeToConvex('text[]')).toBe('v.array(v.string())')
    expect(sqlTypeToConvex('integer[]')).toBe('v.array(v.number())')
    expect(sqlTypeToConvex('boolean[]')).toBe('v.array(v.boolean())')
  })

  it('strips pg_catalog. prefix', () => {
    expect(sqlTypeToConvex('pg_catalog.int4')).toBe('v.number()')
    expect(sqlTypeToConvex('pg_catalog.text')).toBe('v.string()')
  })

  it('returns v.any() for unknown types', () => {
    expect(sqlTypeToConvex('unknown_type')).toBe('v.any()')
    expect(sqlTypeToConvex(null)).toBe('v.any()')
    expect(sqlTypeToConvex(undefined)).toBe('v.any()')
  })
})

describe('columnToValidator', () => {
  it('returns bare validator for non-nullable column', () => {
    const col = { dataType: 'text', nullable: false, constraints: [] }
    expect(columnToValidator(col)).toBe('v.string()')
  })

  it('wraps in v.optional() for nullable column', () => {
    const col = { dataType: 'text', nullable: true, constraints: [] }
    expect(columnToValidator(col)).toBe('v.optional(v.string())')
  })

  it('handles nullable integer array', () => {
    const col = { dataType: 'integer[]', nullable: true, constraints: [] }
    expect(columnToValidator(col)).toBe('v.optional(v.array(v.number()))')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:convex
```

Expected: FAIL — `Cannot find module '../src/sql-type-map.js'`

- [ ] **Step 3: Implement `packages/convex/src/sql-type-map.js`**

```js
const TYPE_MAP = {
  text: 'v.string()',
  varchar: 'v.string()',
  char: 'v.string()',
  citext: 'v.string()',
  uuid: 'v.string()',
  name: 'v.string()',
  bpchar: 'v.string()',

  int: 'v.number()',
  int2: 'v.number()',
  int4: 'v.number()',
  int8: 'v.number()',
  integer: 'v.number()',
  bigint: 'v.number()',
  smallint: 'v.number()',
  serial: 'v.number()',
  bigserial: 'v.number()',
  smallserial: 'v.number()',

  float4: 'v.number()',
  float8: 'v.number()',
  real: 'v.number()',
  numeric: 'v.number()',
  decimal: 'v.number()',
  money: 'v.number()',
  'double precision': 'v.number()',

  boolean: 'v.boolean()',
  bool: 'v.boolean()',

  json: 'v.any()',
  jsonb: 'v.any()',

  timestamp: 'v.string()',
  timestamptz: 'v.string()',
  'timestamp without time zone': 'v.string()',
  'timestamp with time zone': 'v.string()',
  date: 'v.string()',
  time: 'v.string()',
  timetz: 'v.string()',
  'time without time zone': 'v.string()',
  'time with time zone': 'v.string()',
  interval: 'v.string()',

  bytea: 'v.bytes()'
}

/**
 * Convert a SQL type string to a Convex validator string.
 *
 * @param {string|null|undefined} sqlType - e.g. 'text', 'integer[]', 'varchar(255)'
 * @returns {string} e.g. 'v.string()', 'v.array(v.number())'
 */
export function sqlTypeToConvex(sqlType) {
  if (!sqlType) return 'v.any()'

  // Strip length/precision specs: varchar(255), numeric(10,2)
  const clean = sqlType
    .toLowerCase()
    .replace(/\(\s*\d+(?:\s*,\s*\d+)?\s*\)/, '')
    .trim()

  // Handle array types: text[], integer[]
  if (clean.endsWith('[]')) {
    const inner = sqlTypeToConvex(clean.slice(0, -2))
    return `v.array(${inner})`
  }

  // Strip pg_catalog. prefix from pgsql-parser output
  const withoutCatalog = clean.replace(/^pg_catalog\./, '')

  return TYPE_MAP[withoutCatalog] ?? TYPE_MAP[clean] ?? 'v.any()'
}

/**
 * Convert a parsed column definition to a Convex validator string,
 * wrapping in v.optional() if the column is nullable.
 *
 * @param {{ dataType: string, nullable: boolean }} column
 * @returns {string}
 */
export function columnToValidator(column) {
  const base = sqlTypeToConvex(column.dataType)
  return column.nullable ? `v.optional(${base})` : base
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:convex
```

Expected: all tests in `sql-type-map.spec.js` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/src/sql-type-map.js packages/convex/spec/sql-type-map.spec.js
git commit -m "feat(convex): SQL type to Convex validator map"
```

---

## Task 3: Schema generator

**Files:**
- Create: `packages/convex/src/schema-generator.js`
- Create: `packages/convex/spec/schema-generator.spec.js`

- [ ] **Step 1: Write failing tests**

Create `packages/convex/spec/schema-generator.spec.js`:

```js
import { describe, it, expect } from 'vitest'
import { resolveTableName, generateSchemaTs } from '../src/schema-generator.js'

const makeTable = (schema, tableName, columns = []) => ({
  type: 'table',
  name: `${schema}.${tableName}`,
  schema,
  columns,
  constraints: [],
  errors: [],
  warnings: []
})

const basicColumns = [
  { name: 'id', dataType: 'uuid', nullable: false, constraints: [{ type: 'PRIMARY KEY' }], defaultValue: 'gen_random_uuid()' },
  { name: 'label', dataType: 'text', nullable: false, constraints: [], defaultValue: null },
  { name: 'notes', dataType: 'text', nullable: true, constraints: [], defaultValue: null }
]

describe('resolveTableName', () => {
  it('strips schema by default', () => {
    expect(resolveTableName(makeTable('public', 'users'))).toBe('users')
    expect(resolveTableName(makeTable('config', 'features'))).toBe('features')
  })

  it('strips schema when schemaPrefix is false', () => {
    expect(resolveTableName(makeTable('config', 'features'), { schemaPrefix: false })).toBe('features')
  })

  it('prepends schema_ when schemaPrefix is true', () => {
    expect(resolveTableName(makeTable('config', 'features'), { schemaPrefix: true })).toBe('config_features')
  })

  it('skips public schema by default when schemaPrefix is true', () => {
    expect(resolveTableName(makeTable('public', 'users'), { schemaPrefix: true })).toBe('users')
  })

  it('respects custom schemaPrefixSkip list', () => {
    const config = { schemaPrefix: true, schemaPrefixSkip: ['staging'] }
    expect(resolveTableName(makeTable('staging', 'orders'), config)).toBe('orders')
    expect(resolveTableName(makeTable('public', 'users'), config)).toBe('public_users')
  })
})

describe('generateSchemaTs', () => {
  it('filters to table entities only', () => {
    const entities = [
      makeTable('public', 'users', basicColumns),
      { type: 'view', name: 'public.active_users', schema: 'public', columns: basicColumns, errors: [] },
      { type: 'function', name: 'public.get_user', schema: 'public', errors: [] }
    ]
    const { content } = generateSchemaTs(entities)
    expect(content).toContain('users:')
    expect(content).not.toContain('active_users:')
    expect(content).not.toContain('get_user:')
  })

  it('drops primary key columns', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).not.toContain('id:')
    expect(content).toContain('label:')
    expect(content).toContain('notes:')
  })

  it('uses v.optional() for nullable columns', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).toContain('notes: v.optional(v.string())')
    expect(content).toContain('label: v.string()')
  })

  it('generates valid schema.ts structure', () => {
    const { content } = generateSchemaTs([makeTable('public', 'users', basicColumns)])
    expect(content).toContain('import { defineSchema, defineTable } from "convex/server"')
    expect(content).toContain('import { v } from "convex/values"')
    expect(content).toContain('export default defineSchema({')
    expect(content).toContain('users: defineTable({')
  })

  it('handles schemaPrefix config', () => {
    const { content } = generateSchemaTs(
      [makeTable('config', 'features', basicColumns)],
      { schemaPrefix: true }
    )
    expect(content).toContain('config_features: defineTable({')
  })

  it('detects and warns on table name collisions', () => {
    const entities = [
      makeTable('public', 'orders', basicColumns),
      makeTable('staging', 'orders', basicColumns)
    ]
    const { content, warnings } = generateSchemaTs(entities)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('collision')
    expect(content).toContain('orders_staging: defineTable({')
  })

  it('returns empty schema for no table entities', () => {
    const { content, warnings } = generateSchemaTs([])
    expect(content).toContain('export default defineSchema({')
    expect(warnings).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:convex
```

Expected: FAIL — `Cannot find module '../src/schema-generator.js'`

- [ ] **Step 3: Implement `packages/convex/src/schema-generator.js`**

```js
import { columnToValidator } from './sql-type-map.js'

const DEFAULT_SKIP = ['public']

/**
 * Resolve the Convex table name from a DDL entity.
 *
 * @param {{ name: string, schema: string }} entity
 * @param {{ schemaPrefix?: boolean, schemaPrefixSkip?: string[] }} [convexConfig]
 * @returns {string}
 */
export function resolveTableName(entity, convexConfig = {}) {
  const { schemaPrefix = false, schemaPrefixSkip = DEFAULT_SKIP } = convexConfig
  const tableName = entity.name.split('.').pop()
  const schema = entity.schema

  if (!schemaPrefix || schemaPrefixSkip.includes(schema)) return tableName
  return `${schema}_${tableName}`
}

function isPrimaryKey(column) {
  return column.constraints?.some((c) => c.type === 'PRIMARY KEY') ?? false
}

function tableToLines(entity, convexConfig) {
  return (entity.columns ?? [])
    .filter((col) => !isPrimaryKey(col))
    .map((col) => `    ${col.name}: ${columnToValidator(col)},`)
}

/**
 * Generate the content of convex/schema.ts from parsed DDL entities.
 *
 * @param {Object[]} entities - Parsed entities (only 'table' type are used)
 * @param {{ schemaPrefix?: boolean, schemaPrefixSkip?: string[] }} [convexConfig]
 * @returns {{ content: string, warnings: string[] }}
 */
export function generateSchemaTs(entities, convexConfig = {}) {
  const tables = entities.filter((e) => e.type === 'table')
  const seenNames = new Map()
  const warnings = []
  const tableDefs = []

  for (const entity of tables) {
    let convexName = resolveTableName(entity, convexConfig)

    if (seenNames.has(convexName)) {
      const collisionName = `${convexName}_${entity.schema}`
      warnings.push(
        `Table name collision: "${convexName}" used by "${seenNames.get(convexName)}" and "${entity.name}". Using "${collisionName}" for the latter.`
      )
      convexName = collisionName
    } else {
      seenNames.set(convexName, entity.name)
    }

    tableDefs.push({ name: convexName, lines: tableToLines(entity, convexConfig) })
  }

  const tableSection = tableDefs
    .map(({ name, lines }) => [`  ${name}: defineTable({`, ...lines, `  }),`].join('\n'))
    .join('\n')

  const content = [
    '// convex/schema.ts — generated by dbd',
    'import { defineSchema, defineTable } from "convex/server";',
    'import { v } from "convex/values";',
    '',
    'export default defineSchema({',
    tableSection,
    '});',
    ''
  ].join('\n')

  return { content, warnings }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:convex
```

Expected: all tests in `schema-generator.spec.js` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/src/schema-generator.js packages/convex/spec/schema-generator.spec.js
git commit -m "feat(convex): schema generator — DDL entities to convex/schema.ts"
```

---

## Task 4: Data seeder

**Files:**
- Create: `packages/convex/src/data-seeder.js`
- Create: `packages/convex/spec/data-seeder.spec.js`

- [ ] **Step 1: Write failing tests**

Create `packages/convex/spec/data-seeder.spec.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildImportArgs, convexImportCommand } from '../src/data-seeder.js'

describe('buildImportArgs', () => {
  it('returns arg array for csv in dev', () => {
    expect(buildImportArgs('users', 'data.csv', 'csv', false)).toEqual([
      'convex', 'import', '--table', 'users', '--format', 'csv', 'data.csv'
    ])
  })

  it('returns arg array with --prod flag', () => {
    expect(buildImportArgs('users', 'data.csv', 'csv', true)).toEqual([
      'convex', 'import', '--table', 'users', '--format', 'csv', '--prod', 'data.csv'
    ])
  })

  it('maps json format to jsonl', () => {
    expect(buildImportArgs('users', 'data.json', 'json', false)).toEqual([
      'convex', 'import', '--table', 'users', '--format', 'jsonl', 'data.json'
    ])
  })

  it('defaults unknown format to jsonl', () => {
    expect(buildImportArgs('users', 'data.tsv', 'tsv', false)).toEqual([
      'convex', 'import', '--table', 'users', '--format', 'jsonl', 'data.tsv'
    ])
  })
})

describe('convexImportCommand', () => {
  it('returns a human-readable command string for dry-run display', () => {
    expect(convexImportCommand('users', 'data.csv', 'csv', false)).toBe(
      'npx convex import --table users --format csv data.csv'
    )
  })

  it('includes --prod in command string', () => {
    expect(convexImportCommand('users', 'data.csv', 'csv', true)).toBe(
      'npx convex import --table users --format csv --prod data.csv'
    )
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:convex
```

Expected: FAIL — `Cannot find module '../src/data-seeder.js'`

- [ ] **Step 3: Implement `packages/convex/src/data-seeder.js`**

```js
import { execFileSync } from 'child_process'
import { resolveTableName } from './schema-generator.js'

const FORMAT_MAP = {
  csv: 'csv',
  jsonl: 'jsonl',
  json: 'jsonl'
}

/**
 * Build the argument array for `npx convex import`.
 * Uses an array (not a shell string) to prevent injection.
 *
 * @param {string} tableName - Convex table name
 * @param {string} file - Path to the data file
 * @param {string} format - Source format: 'csv', 'jsonl', or 'json'
 * @param {boolean} isProd - Whether to target the prod deployment
 * @returns {string[]}
 */
export function buildImportArgs(tableName, file, format, isProd) {
  const fmt = FORMAT_MAP[format] ?? 'jsonl'
  const args = ['convex', 'import', '--table', tableName, '--format', fmt]
  if (isProd) args.push('--prod')
  args.push(file)
  return args
}

/**
 * Build a human-readable `npx convex import` command string for dry-run display.
 *
 * @param {string} tableName
 * @param {string} file
 * @param {string} format
 * @param {boolean} isProd
 * @returns {string}
 */
export function convexImportCommand(tableName, file, format, isProd) {
  return ['npx', ...buildImportArgs(tableName, file, format, isProd)].join(' ')
}

/**
 * Seed a single table into Convex by shelling to `npx convex import`.
 * Uses execFileSync with an argument array (not a shell string).
 *
 * @param {{ name: string, schema: string, file: string, format?: string }} table
 * @param {{ schemaPrefix?: boolean, schemaPrefixSkip?: string[] }} convexConfig
 * @param {boolean} isProd
 */
export function seedTable(table, convexConfig, isProd = false) {
  const tableName = resolveTableName(table, convexConfig)
  const args = buildImportArgs(tableName, table.file, table.format ?? 'csv', isProd)
  execFileSync('npx', args, { stdio: 'inherit', env: { ...process.env } })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:convex
```

Expected: all tests in `data-seeder.spec.js` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/src/data-seeder.js packages/convex/spec/data-seeder.spec.js
git commit -m "feat(convex): data seeder — shells to npx convex import via execFileSync"
```

---

## Task 5: Export from package index

**Files:**
- Modify: `packages/convex/src/index.js`

- [ ] **Step 1: Update `packages/convex/src/index.js`**

```js
export { sqlTypeToConvex, columnToValidator } from './sql-type-map.js'
export { generateSchemaTs, resolveTableName } from './schema-generator.js'
export { buildImportArgs, convexImportCommand, seedTable } from './data-seeder.js'
```

- [ ] **Step 2: Run all convex tests to confirm nothing broke**

```bash
bun run test:convex
```

Expected: all convex tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/src/index.js
git commit -m "chore(convex): export public API from index.js"
```

---

## Task 6: `design.js` — apply with target=convex

**Files:**
- Modify: `packages/cli/src/design.js`
- Modify: `packages/cli/spec/design.spec.js`

- [ ] **Step 1: Write failing tests for apply with target=convex**

Add these tests inside the existing `describe('Design class (packages/cli)')` block in `packages/cli/spec/design.spec.js`:

```js
import { existsSync, readFileSync, unlinkSync, rmdirSync } from 'fs'
// (add to existing imports at top of file if not already present)

describe('apply with target=convex', () => {
  it('dry-run prints schema.ts content without writing file', async () => {
    const dx = (await using('design.yaml')).validate()
    await dx.apply(null, true, 'convex')
    const calls = console.info.mock.calls.map((c) => c[0])
    expect(calls.some((c) => typeof c === 'string' && c.includes('export default defineSchema('))).toBe(true)
    expect(existsSync('convex/schema.ts')).toBe(false)
  })

  it('writes convex/schema.ts to disk on non-dry-run', async () => {
    const dx = (await using('design.yaml')).validate()
    await dx.apply(null, false, 'convex')
    expect(existsSync('convex/schema.ts')).toBe(true)
    const content = readFileSync('convex/schema.ts', 'utf8')
    expect(content).toContain('export default defineSchema(')
    // cleanup
    unlinkSync('convex/schema.ts')
    try { rmdirSync('convex') } catch { /* ignore if dir not empty */ }
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `apply` does not accept a third param yet.

- [ ] **Step 3: Modify `design.apply()` in `packages/cli/src/design.js`**

Change the method signature from `async apply(name, dryRun = false)` to `async apply(name, dryRun = false, target = null)` and add the convex branch as the first block of the method body:

```js
async apply(name, dryRun = false, target = null) {
  if (target === 'convex') {
    if (!this.isValidated) this.validate()
    const { generateSchemaTs } = await import('@jerrythomas/dbd-convex')
    const convexConfig = this.#config.convex ?? {}
    const { content, warnings } = generateSchemaTs(this.entities, convexConfig)
    warnings.forEach((w) => console.warn(w))

    if (dryRun) {
      console.info(content)
      return
    }

    fs.mkdirSync('convex', { recursive: true })
    fs.writeFileSync('convex/schema.ts', content)
    console.info('Generated convex/schema.ts')

    const convexUrl = process.env.CONVEX_URL
    const convexKey = process.env.CONVEX_DEPLOY_KEY
    if (convexUrl && convexKey) {
      const { execFileSync } = await import('child_process')
      execFileSync('npx', ['convex', 'deploy'], { stdio: 'inherit', env: { ...process.env } })
    } else {
      console.info('CONVEX_URL or CONVEX_DEPLOY_KEY not set — skipping deploy')
    }
    return
  }

  // existing postgres apply logic (unchanged — keep the if (!this.isValidated) and rest as-is)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all CLI tests pass including the two new convex apply tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): design.apply() routes to convex schema generator when target=convex"
```

---

## Task 7: `design.js` — importData with target=convex

**Files:**
- Modify: `packages/cli/src/design.js`
- Modify: `packages/cli/spec/design.spec.js`

- [ ] **Step 1: Write failing tests**

Add to `packages/cli/spec/design.spec.js` inside the `describe('Design class')` block:

```js
describe('importData with target=convex', () => {
  it('dry-run prints npx convex import commands to stdout', async () => {
    const dx = (await using('design.yaml')).validate()
    await dx.importData(null, true, 'convex')
    const calls = console.info.mock.calls.map((c) => c[0])
    const convexCalls = calls.filter((c) => typeof c === 'string' && c.startsWith('npx convex import'))
    // example project may have 0 import tables — just confirm no error thrown
    expect(Array.isArray(convexCalls)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
bun run test:cli
```

Expected: FAIL — `importData` signature mismatch.

- [ ] **Step 3: Modify `design.importData()` in `packages/cli/src/design.js`**

Change signature from `async importData(name, dryRun = false)` to `async importData(name, dryRun = false, target = null)` and add the convex branch as the first block:

```js
async importData(name, dryRun = false, target = null) {
  if (target === 'convex') {
    if (!this.isValidated) this.validate()
    const { seedTable, convexImportCommand, resolveTableName } = await import('@jerrythomas/dbd-convex')
    const convexConfig = this.#config.convex ?? {}
    const isProd = this.#env === 'prod'

    const plan = this.importTables
      .filter((table) => !table.errors || table.errors.length === 0)
      .filter((table) => !name || table.name === name || table.file === name)

    if (dryRun) {
      for (const table of plan) {
        const tableName = resolveTableName(table, convexConfig)
        console.info(convexImportCommand(tableName, table.file, table.format ?? 'csv', isProd))
      }
      return this
    }

    for (const table of plan) {
      console.info(`Seeding ${table.name} into Convex`)
      table.warnings.forEach((w) => console.warn(w))
      seedTable(table, convexConfig, isProd)
    }
    return this
  }

  // existing postgres importData logic (unchanged — keep the if (!this.isValidated) and rest as-is)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all CLI tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): design.importData() routes to Convex seeder when target=convex"
```

---

## Task 8: CLI commands — `--target` flag and `dbd convex` subcommands

**Files:**
- Modify: `packages/cli/src/index.js`

- [ ] **Step 1: Add `--target` option to the `apply` command**

Find the `apply` command block (lines ~89-98 in `packages/cli/src/index.js`) and replace it:

```js
prog
  .command('apply')
  .option('-n, --name', 'apply a specific entity or file only')
  .option('--dry-run', 'just print the entities', false)
  .option('--target', 'output target: leave unset for postgres, or "convex" to generate schema.ts', null)
  .describe('Apply the database scripts to database.')
  .example('dbd apply')
  .example('dbd apply --target=convex')
  .example('dbd apply --target=convex --dry-run')
  .action(async (opts) => {
    await (await using(opts.config, opts.database)).apply(opts.name, opts['dry-run'], opts.target)
  })
```

- [ ] **Step 2: Add `--target` option to the `import` command**

Find the `import` command block (lines ~111-123) and replace it:

```js
prog
  .command('import')
  .option('-n, --name', 'Optional name or file to be imported.')
  .option('--dry-run', 'just print the entities', false)
  .option('--target', 'output target: leave unset for postgres, or "convex" to seed via npx convex import', null)
  .describe('Load csv files into database')
  .example('dbd import')
  .example('dbd import -n staging.lookups')
  .example('dbd import --target=convex')
  .action(async (opts) => {
    const env = normalizeEnv(opts.environment)
    await (await using(opts.config, opts.database, env)).importData(opts.name, opts['dry-run'], opts.target)
    console.log('Import complete.')
  })
```

- [ ] **Step 3: Add `dbd convex schema` subcommand**

Add after the `grants` command block (before `process.on('unhandledRejection',...)`):

```js
prog
  .command('convex schema')
  .option('-n, --name', 'apply a specific entity only')
  .option('--dry-run', 'print schema.ts to stdout only', false)
  .describe('Generate convex/schema.ts from DDL entities. Deploys if CONVEX_URL and CONVEX_DEPLOY_KEY are set.')
  .example('dbd convex schema')
  .example('dbd convex schema --dry-run')
  .action(async (opts) => {
    await (await using(opts.config, opts.database)).apply(opts.name, opts['dry-run'], 'convex')
  })
```

- [ ] **Step 4: Add `dbd convex seed` subcommand**

```js
prog
  .command('convex seed')
  .option('-n, --name', 'Optional name or file to be seeded.')
  .option('--dry-run', 'print what would be seeded', false)
  .describe('Seed data into Convex deployment from import files.')
  .example('dbd convex seed')
  .example('dbd convex seed -n staging.users')
  .example('dbd convex seed --dry-run')
  .action(async (opts) => {
    const env = normalizeEnv(opts.environment)
    await (await using(opts.config, opts.database, env)).importData(opts.name, opts['dry-run'], 'convex')
    console.log('Seed complete.')
  })
```

- [ ] **Step 5: Run all tests**

```bash
bun run test
```

Expected: all workspace tests pass.

- [ ] **Step 6: Run lint**

```bash
bun run lint
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.js
git commit -m "feat(cli): add --target=convex to apply/import; add dbd convex schema/seed subcommands"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun run test
```

Expected: all tests pass across all workspace projects.

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: 0 errors.

- [ ] **Step 3: Smoke-test dry-run from example directory**

```bash
cd example
node ../packages/cli/src/index.js convex schema --dry-run
```

Expected: prints `convex/schema.ts` content (with `export default defineSchema(`) to stdout without creating a file.

```bash
node ../packages/cli/src/index.js import --target=convex --dry-run
```

Expected: prints `npx convex import --table ...` lines (or "Import complete." if no import tables configured in example).

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix(convex): address any issues from final verification pass"
```
