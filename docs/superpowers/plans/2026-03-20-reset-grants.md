# Reset and Grants Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dbd reset` (drop schemas to bare state, Supabase-safe by default) and `dbd grants` (apply PostgREST role grants from design.yaml) commands.

**Architecture:** Pure functions `buildResetScript` / `buildGrantsScript` in `packages/db/src/script-builder.js` generate SQL; `design.js` methods call `adapter.executeScript()`; schema grants declared per-schema in `design.yaml` via a new `config.schemaGrants` field that leaves `config.schemas` (string[]) untouched.

**Tech Stack:** Node.js ES Modules, Vitest, Bun, `packages/db` + `packages/cli` monorepo packages, `sade` CLI framework.

---

**Spec:** `docs/superpowers/specs/2026-03-20-reset-grants-design.md`

---

## Chunk 1: Config normalization and pure script-builder functions

### Task 1: `normalizeSchema` and `schemaGrants` in config.js

**Files:**

- Modify: `packages/cli/src/config.js`
- Test: `packages/cli/spec/config.spec.js`

**Context:**

`config.js` exports `read(file)` which returns a data object. It currently sets `data.schemas = data.schemas || []` as a plain `string[]`. We need to:

1. Add `normalizeSchema(entry)` that handles both string entries (`'config'`) and object entries (`{ config: { grants: { anon: ['usage', 'select'] } } }`)
2. Call it in `read()` to populate `data.schemaGrants` (array of `{ name, grants }` for schemas that have grants) while keeping `data.schemas` as `string[]`

`config.schemas` in `design.yaml` can be:

```yaml
schemas:
  - config: # object form
      grants:
        anon: [usage, select]
  - extensions # string form
```

YAML parses `- config:` with nested keys as `{ config: { grants: {...} } }`. YAML parses `- extensions` as just the string `'extensions'`.

- [ ] **Step 1: Write failing tests for `normalizeSchema`**

Add to `packages/cli/spec/config.spec.js`, inside the existing `describe('config', ...)` block, after the existing `describe('read()', ...)` block:

```js
import {
  scan,
  read,
  fillMissingInfoForEntities,
  merge,
  clean,
  cleanDDLEntities,
  normalizeEnv,
  normalizeSchema // add this import
} from '../src/config.js'
```

Then add this describe block:

```js
describe('normalizeSchema()', () => {
  it('handles a plain string entry', () => {
    expect(normalizeSchema('config')).toEqual({ name: 'config', grants: null })
  })

  it('handles an object entry with grants', () => {
    const entry = { config: { grants: { anon: ['usage', 'select'] } } }
    expect(normalizeSchema(entry)).toEqual({
      name: 'config',
      grants: { anon: ['usage', 'select'] }
    })
  })

  it('handles an object entry without grants key', () => {
    const entry = { staging: {} }
    expect(normalizeSchema(entry)).toEqual({ name: 'staging', grants: null })
  })

  it('throws on invalid permission value', () => {
    const entry = { config: { grants: { anon: ['usage', 'seelct'] } } }
    expect(() => normalizeSchema(entry)).toThrow('Unknown grant permissions')
  })
})

describe('read() schemaGrants', () => {
  it('config.schemas stays string[] after read()', () => {
    process.chdir(exampleDir)
    const data = read('design.yaml')
    expect(Array.isArray(data.schemas)).toBe(true)
    data.schemas.forEach((s) => expect(typeof s).toBe('string'))
  })

  it('config.schemaGrants is an array', () => {
    process.chdir(exampleDir)
    const data = read('design.yaml')
    expect(Array.isArray(data.schemaGrants)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:cli 2>&1 | grep -E "FAIL|normalizeSchema|schemaGrants"
```

Expected: tests fail with "normalizeSchema is not exported" or similar.

- [ ] **Step 3: Implement `normalizeSchema` in `config.js`**

Add after the `ENV_ALIASES` constant block (after line 22), before the `normalizeEnv` export:

```js
const VALID_GRANT_PERMS = ['usage', 'select', 'insert', 'update', 'delete', 'all']

/**
 * Parses a schema entry from design.yaml into { name, grants }.
 * Accepts either a plain string or an object like { schemaName: { grants: {...} } }.
 * Throws if any grant permission value is not in VALID_GRANT_PERMS.
 *
 * @param {string|Object} entry
 * @returns {{ name: string, grants: Object|null }}
 */
export function normalizeSchema(entry) {
  if (typeof entry === 'string') return { name: entry, grants: null }
  const [name, config] = Object.entries(entry)[0]
  const grants = config?.grants ?? null
  if (grants) {
    for (const [role, perms] of Object.entries(grants)) {
      const invalid = perms.filter((p) => !VALID_GRANT_PERMS.includes(p))
      if (invalid.length)
        throw new Error(`Unknown grant permissions for ${name}.${role}: ${invalid.join(', ')}`)
    }
  }
  return { name, grants }
}
```

Then update `read()` to use `normalizeSchema`. The current `read()` body is:

```js
export function read(file) {
  let data = load(readFileSync(file, 'utf8'))
  data = fillMissingInfoForEntities(data)
  data.schemas = data.schemas || []
  data.entities = [...data.tables, ...data.views, ...data.functions, ...data.procedures]
  data.project = { staging: [], ...data.project }
  return data
}
```

Replace with:

```js
export function read(file) {
  let data = load(readFileSync(file, 'utf8'))
  data = fillMissingInfoForEntities(data)
  const normalizedSchemas = (data.schemas || []).map(normalizeSchema)
  data.schemas = normalizedSchemas.map((s) => s.name)
  data.schemaGrants = normalizedSchemas.filter((s) => s.grants)
  data.entities = [...data.tables, ...data.views, ...data.functions, ...data.procedures]
  data.project = { staging: [], ...data.project }
  return data
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:cli 2>&1 | grep -E "PASS|FAIL|normalizeSchema|schemaGrants"
```

Expected: all new tests pass, all existing tests pass (schemas are still strings).

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/config.js packages/cli/spec/config.spec.js
git commit -m "feat(cli): add normalizeSchema and schemaGrants support in config"
```

---

### Task 2: `buildResetScript` and `buildGrantsScript` pure functions

**Files:**

- Create: `packages/db/src/script-builder.js`
- Test: `packages/db/spec/script-builder.spec.js`

**Context:**

These are pure functions — no DB connections, no file I/O. They take config data and return SQL strings.

`buildResetScript(schemas, roles, target)`:

- `schemas`: `string[]` — schema names from `config.schemas`
- `roles`: array of role objects with `.name` — from `config.roles` (pre-sorted by dependency; we reverse for drop order)
- `target`: `'supabase'` (default) or `'postgres'`

`buildGrantsScript(schemaGrants, target)`:

- `schemaGrants`: `[{ name, grants }]` — from `config.schemaGrants` (only schemas with grants declared)
- `target`: `'supabase'` (default) or `'postgres'`

For `buildGrantsScript`, each schema grant entry like `{ anon: ['usage', 'select'] }` produces:

1. `GRANT USAGE ON SCHEMA config TO anon;` (for `usage`)
2. `GRANT SELECT ON ALL TABLES IN SCHEMA config TO anon;` (for `select`)
3. `ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT ON TABLES TO anon;` (for `select`)

- [ ] **Step 1: Write failing tests**

Create `packages/db/spec/script-builder.spec.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildResetScript, buildGrantsScript } from '../src/script-builder.js'

describe('buildResetScript', () => {
  const roles = [
    { name: 'basic' },
    { name: 'advanced' } // advanced depends on basic, so sorted: [basic, advanced]
  ]

  it('supabase target: drops user schemas, skips protected schemas', () => {
    const script = buildResetScript(['config', 'auth', 'staging'], [], 'supabase')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS staging CASCADE;')
    expect(script).not.toContain('auth')
  })

  it('supabase target: only protected schemas → returns empty string', () => {
    const script = buildResetScript(['auth', 'storage'], [], 'supabase')
    expect(script).toBe('')
  })

  it('supabase target: mix of protected and user schemas → only user schemas dropped', () => {
    const script = buildResetScript(['auth', 'config'], [], 'supabase')
    expect(script).not.toContain('auth')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
  })

  it('supabase target: roles are not dropped', () => {
    const script = buildResetScript(['config'], roles, 'supabase')
    expect(script).not.toContain('DROP ROLE')
  })

  it('postgres target: drops all schemas', () => {
    const script = buildResetScript(['config', 'auth', 'staging'], [], 'postgres')
    expect(script).toContain('DROP SCHEMA IF EXISTS config CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS auth CASCADE;')
    expect(script).toContain('DROP SCHEMA IF EXISTS staging CASCADE;')
  })

  it('postgres target: drops roles in reverse dependency order', () => {
    const script = buildResetScript(['config'], roles, 'postgres')
    expect(script).toContain('DROP ROLE IF EXISTS basic;')
    expect(script).toContain('DROP ROLE IF EXISTS advanced;')
    // advanced (index 1) reversed → dropped before basic (index 0)
    const advancedPos = script.indexOf('DROP ROLE IF EXISTS advanced;')
    const basicPos = script.indexOf('DROP ROLE IF EXISTS basic;')
    expect(advancedPos).toBeLessThan(basicPos)
  })

  it('empty schemas array: returns empty string', () => {
    expect(buildResetScript([], [], 'supabase')).toBe('')
    expect(buildResetScript([], [], 'postgres')).toBe('')
  })

  it('defaults to supabase target', () => {
    const script = buildResetScript(['auth', 'config'], [])
    expect(script).not.toContain('auth')
    expect(script).toContain('config')
  })
})

describe('buildGrantsScript', () => {
  const schemaGrants = [
    {
      name: 'config',
      grants: {
        anon: ['usage', 'select'],
        service_role: ['usage', 'all']
      }
    }
  ]

  it('supabase target: generates GRANT USAGE for usage perm', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO service_role;')
  })

  it('supabase target: generates GRANT ON ALL TABLES for table-level perms', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA config TO anon;')
    expect(script).toContain('GRANT ALL ON ALL TABLES IN SCHEMA config TO service_role;')
  })

  it('supabase target: generates ALTER DEFAULT PRIVILEGES for table-level perms', () => {
    const script = buildGrantsScript(schemaGrants, 'supabase')
    expect(script).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT ON TABLES TO anon;'
    )
    expect(script).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT ALL ON TABLES TO service_role;'
    )
  })

  it('postgres target: returns empty string', () => {
    expect(buildGrantsScript(schemaGrants, 'postgres')).toBe('')
  })

  it('empty schemaGrants array: returns empty string', () => {
    expect(buildGrantsScript([], 'supabase')).toBe('')
  })

  it('schema without grants: skipped', () => {
    // schemaGrants only contains schemas with grants — this tests the filter works
    const script = buildGrantsScript([], 'supabase')
    expect(script).toBe('')
  })

  it('defaults to supabase target', () => {
    const script = buildGrantsScript(schemaGrants)
    expect(script).toContain('GRANT USAGE ON SCHEMA config TO anon;')
  })

  it('all table-level permission types are uppercased in output', () => {
    const grants = [{ name: 'api', grants: { anon: ['insert', 'update', 'delete'] } }]
    const script = buildGrantsScript(grants, 'supabase')
    expect(script).toContain('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:db 2>&1 | grep -E "FAIL|script-builder|Cannot find"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `script-builder.js`**

Create `packages/db/src/script-builder.js`:

```js
/**
 * SQL script builders for reset and grants operations.
 *
 * Pure functions — no I/O. Input is config data, output is a SQL string.
 */

const SUPABASE_PROTECTED = [
  'auth',
  'storage',
  'realtime',
  'supabase_functions',
  '_realtime',
  'supabase_migrations',
  'pgbouncer',
  'vault',
  'graphql',
  'graphql_public'
]

/**
 * Builds a SQL script that drops all design.yaml schemas (and roles for postgres target).
 *
 * @param {string[]} schemas - Schema names from config.schemas
 * @param {Object[]} roles - Role objects with .name, pre-sorted by dependency
 * @param {'supabase'|'postgres'} [target='supabase'] - Target platform
 * @returns {string} SQL script (empty string if nothing to drop)
 */
export function buildResetScript(schemas, roles, target = 'supabase') {
  if (target === 'supabase') {
    return schemas
      .filter((s) => !SUPABASE_PROTECTED.includes(s))
      .map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`)
      .join('\n')
  }

  const dropSchemas = schemas.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`)
  const dropRoles = [...roles].reverse().map((r) => `DROP ROLE IF EXISTS ${r.name};`)
  return [...dropSchemas, ...dropRoles].join('\n')
}

/**
 * Builds a SQL script that applies schema grants for Supabase PostgREST roles.
 * No-op for postgres target.
 *
 * @param {{ name: string, grants: Object }[]} schemaGrants - From config.schemaGrants
 * @param {'supabase'|'postgres'} [target='supabase'] - Target platform
 * @returns {string} SQL script (empty string if nothing to grant)
 */
export function buildGrantsScript(schemaGrants, target = 'supabase') {
  if (target !== 'supabase') return ''

  return schemaGrants
    .flatMap(({ name, grants }) =>
      Object.entries(grants).flatMap(([role, perms]) => {
        const lines = []
        if (perms.includes('usage')) lines.push(`GRANT USAGE ON SCHEMA ${name} TO ${role};`)
        const tablePerms = perms.filter((p) => p !== 'usage').map((p) => p.toUpperCase())
        if (tablePerms.length) {
          lines.push(`GRANT ${tablePerms.join(', ')} ON ALL TABLES IN SCHEMA ${name} TO ${role};`)
          lines.push(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${name} GRANT ${tablePerms.join(', ')} ON TABLES TO ${role};`
          )
        }
        return lines
      })
    )
    .join('\n')
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:db 2>&1 | grep -E "PASS|FAIL|script-builder"
```

Expected: all script-builder tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/script-builder.js packages/db/spec/script-builder.spec.js
git commit -m "feat(db): add buildResetScript and buildGrantsScript pure functions"
```

---

### Task 3: Export new functions from `packages/db/src/index.js`

**Files:**

- Modify: `packages/db/src/index.js`

**Context:**

`packages/db/src/index.js` is the public API of `@jerrythomas/dbd-db`. All new functions used by `design.js` must be exported here. `design.js` imports from `@jerrythomas/dbd-db`.

- [ ] **Step 1: Add exports to `packages/db/src/index.js`**

Add at the end of the file:

```js
export { buildResetScript, buildGrantsScript } from './script-builder.js'
```

- [ ] **Step 2: Verify the export works**

```bash
bun run test:db 2>&1 | tail -5
```

Expected: all tests pass (no import errors).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/index.js
git commit -m "feat(db): export buildResetScript and buildGrantsScript"
```

---

## Chunk 2: Design class methods and CLI commands

### Task 4: `reset()` and `grants()` methods in `design.js`

**Files:**

- Modify: `packages/cli/src/design.js`
- Test: `packages/cli/spec/design.spec.js`

**Context:**

`design.js` exports `using(configFile, databaseURL, env)` which returns a `Design` instance. The `Design` class is defined privately and the instance is returned by `using()`.

Key things to know:

- `this.#config.schemas` is `string[]` (schema names)
- `this.#config.schemaGrants` is `[{ name, grants }]` — set in `read()`, passed through `clean()` via spread
- `this.#config.roles` is `Object[]` with `.name`, pre-sorted by dependency
- `this.#adapter` is the psql adapter (already set in constructor)
- `this.getAdapter()` returns `this.#adapter` (look at existing `apply()` method for the pattern)
- Import `buildResetScript` and `buildGrantsScript` from `@jerrythomas/dbd-db`

Look at the existing `importData()` method to understand the dry-run + live pattern.

Important: `schemaGrants` comes from `read()` and passes through `clean()` via `{ ...data, roles, schemas, entities, importTables }`. You need to ensure `clean()` preserves it. Check `packages/cli/src/config.js` line 142 — `clean()` does `data = { ...data, roles, schemas, entities, importTables }`. This spreads all of `data` first, so `schemaGrants` IS preserved automatically. No change needed to `clean()`.

- [ ] **Step 1: Write failing tests for `reset()` and `grants()`**

Add to `packages/cli/spec/design.spec.js` inside the main `describe` block, after the existing importData tests:

```js
// --- reset ---

describe('reset()', () => {
  it('dry-run prints DROP SCHEMA statements', async () => {
    const dx = await using('design.yaml')
    await dx.reset('supabase', true)

    const infoCalls = console.info.mock.calls.map((c) => c[0])
    expect(
      infoCalls.some((c) => typeof c === 'string' && c.includes('[dry-run] reset script:'))
    ).toBe(true)
    expect(
      infoCalls.some((c) => typeof c === 'string' && c.includes('DROP SCHEMA IF EXISTS'))
    ).toBe(true)
  })

  it('dry-run supabase: protected schemas absent from output', async () => {
    const dx = await using('design.yaml')
    await dx.reset('supabase', true)

    const allOutput = console.info.mock.calls.map((c) => c[0]).join('\n')
    expect(allOutput).not.toContain('DROP SCHEMA IF EXISTS auth')
    expect(allOutput).not.toContain('DROP SCHEMA IF EXISTS storage')
  })

  it('dry-run returns this (chainable)', async () => {
    const dx = await using('design.yaml')
    const result = await dx.reset('supabase', true)
    expect(result).toBe(dx)
  })

  it('prints "No schemas to reset." when nothing to drop on supabase target', async () => {
    const dx = await using('design.yaml')
    // Override schemas to only contain protected ones
    dx.config.schemas = ['auth', 'storage']
    await dx.reset('supabase', true)

    const infoCalls = console.info.mock.calls.map((c) => c[0])
    expect(infoCalls.some((c) => c === 'No schemas to reset.')).toBe(true)
  })
})

// --- grants ---

describe('grants()', () => {
  it('prints info when postgres target', async () => {
    const dx = await using('design.yaml')
    await dx.grants('postgres', false)

    const infoCalls = console.info.mock.calls.map((c) => c[0])
    expect(infoCalls.some((c) => c === 'Grants are not applicable for --target postgres')).toBe(
      true
    )
  })

  it('prints info when no grants configured', async () => {
    const dx = await using('design.yaml')
    dx.config.schemaGrants = [] // force no-grants path regardless of design.yaml state
    await dx.grants('supabase', false)

    const infoCalls = console.info.mock.calls.map((c) => c[0])
    expect(infoCalls.some((c) => c === 'No grants configured in design.yaml')).toBe(true)
  })

  it('dry-run with grants prints GRANT statements', async () => {
    const dx = await using('design.yaml')
    // Inject schemaGrants directly
    dx.config.schemaGrants = [{ name: 'config', grants: { anon: ['usage', 'select'] } }]
    await dx.grants('supabase', true)

    const infoCalls = console.info.mock.calls.map((c) => c[0])
    expect(
      infoCalls.some((c) => typeof c === 'string' && c.includes('[dry-run] grants script:'))
    ).toBe(true)
    expect(
      infoCalls.some(
        (c) => typeof c === 'string' && c.includes('GRANT USAGE ON SCHEMA config TO anon;')
      )
    ).toBe(true)
  })

  it('dry-run returns this (chainable)', async () => {
    const dx = await using('design.yaml')
    const result = await dx.grants('supabase', true)
    expect(result).toBe(dx)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:cli 2>&1 | grep -E "FAIL|reset|grants|TypeError"
```

Expected: FAIL — `dx.reset is not a function` or similar.

- [ ] **Step 3: Add imports to `design.js`**

In `packages/cli/src/design.js`, update the import from `@jerrythomas/dbd-db` to add `buildResetScript` and `buildGrantsScript`:

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
  graphFromEntities,
  buildImportPlan,
  buildResetScript,
  buildGrantsScript
} from '@jerrythomas/dbd-db'
```

- [ ] **Step 4: Add `reset()` and `grants()` methods to the `Design` class**

In `packages/cli/src/design.js`, add these two methods inside the `Design` class, after the existing `exportData()` method (find it by searching for `async exportData`). Add before the closing `}` of the class:

```js
async reset(target = 'supabase', dryRun = false) {
  const script = buildResetScript(this.#config.schemas, this.#config.roles, target)
  if (!script) {
    console.info('No schemas to reset.')
    return this
  }
  if (dryRun) {
    console.info('[dry-run] reset script:')
    console.info(script)
    return this
  }
  const adapter = await this.getAdapter()
  await adapter.executeScript(script)
  console.info('Reset complete.')
  return this
}

async grants(target = 'supabase', dryRun = false) {
  const script = buildGrantsScript(this.#config.schemaGrants ?? [], target)
  if (!script) {
    console.info(
      target === 'postgres'
        ? 'Grants are not applicable for --target postgres'
        : 'No grants configured in design.yaml'
    )
    return this
  }
  if (dryRun) {
    console.info('[dry-run] grants script:')
    console.info(script)
    return this
  }
  const adapter = await this.getAdapter()
  await adapter.executeScript(script)
  console.info('Grants applied.')
  return this
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun run test:cli 2>&1 | grep -E "PASS|FAIL|reset|grants"
```

Expected: all new tests pass.

- [ ] **Step 6: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): add reset() and grants() methods to Design class"
```

---

### Task 5: `reset` and `grants` CLI commands in `index.js`

**Files:**

- Modify: `packages/cli/src/index.js`

**Context:**

`index.js` uses `sade` to define CLI commands. Each command calls `using(opts.config, opts.database)` to get a `Design` instance, then calls a method on it. Pattern from existing commands:

```js
prog
  .command('import')
  .option('-n, --name', 'Optional name or file to be imported.')
  .option('--dry-run', 'just print the entities', false)
  .describe('Load csv files into database')
  .action(async (opts) => {
    const env = normalizeEnv(opts.environment)
    await (await using(opts.config, opts.database, env)).importData(opts.name, opts['dry-run'])
    console.log('Import complete.')
  })
```

Both new commands use `opts['dry-run']` (sade converts `--dry-run` to `dry-run` key). Note: all output is owned by the method itself — `index.js` does NOT print success messages.

- [ ] **Step 1: Add `reset` and `grants` commands to `index.js`**

In `packages/cli/src/index.js`, add these two command blocks before `prog.parse(process.argv)`:

```js
prog
  .command('reset')
  .option('--target', 'Target platform: supabase or postgres', 'supabase')
  .option('--dry-run', 'Print what would be dropped without executing', false)
  .describe('Drop all design.yaml schemas (bare state). Run dbd apply to rebuild.')
  .example('dbd reset')
  .example('dbd reset --target postgres')
  .example('dbd reset --dry-run')
  .action(async (opts) => {
    await (await using(opts.config, opts.database)).reset(opts.target, opts['dry-run'])
  })

prog
  .command('grants')
  .option('--target', 'Target platform: supabase or postgres', 'supabase')
  .option('--dry-run', 'Print what would be granted without executing', false)
  .describe('Apply schema grants declared in design.yaml (Supabase only).')
  .example('dbd grants')
  .example('dbd grants --dry-run')
  .action(async (opts) => {
    await (await using(opts.config, opts.database)).grants(opts.target, opts['dry-run'])
  })
```

- [ ] **Step 2: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Smoke-test the CLI help output**

```bash
cd example && node ../packages/cli/src/index.js --help
```

Expected: `reset` and `grants` appear in the command list.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.js
git commit -m "feat(cli): add reset and grants CLI commands"
```

---

## Chunk 3: Example project and documentation

### Task 6: Update `example/design.yaml` with grants example

**Files:**

- Modify: `example/design.yaml`

**Context:**

The example project is what `dbd init` scaffolds. It should demonstrate the grants feature. Add grants to the `config` schema — the most natural schema to expose via PostgREST.

Current `example/design.yaml` schemas section:

```yaml
schemas:
  - config
  - extensions
  - staging
  - migrate
```

Replace with:

```yaml
schemas:
  - config:
      grants:
        anon: [usage, select]
        authenticated: [usage, select]
        service_role: [usage, all]
  - extensions
  - staging
  - migrate
```

- [ ] **Step 1: Update `example/design.yaml`**

Edit `example/design.yaml`, replacing the `schemas:` block as shown above.

- [ ] **Step 2: Run tests to verify example still works**

```bash
bun run test:cli 2>&1 | tail -10
```

Expected: all tests pass. The `config.schemas` array should still contain `'config'` as a string (normalizeSchema converts it).

- [ ] **Step 3: Commit**

```bash
git add example/design.yaml
git commit -m "feat(example): add grants example for config schema"
```

---

### Task 7: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/llms/02-design-yaml.md`
- Modify: `docs/llms/04-commands.md`
- Modify: `docs/llms/05-import-export.md`

**Context:**

Several features shipped in v2.1.0 and v2.2.0 are not yet documented:

- Dev/prod/shared import separation (`-e` flag, `env:` in design.yaml import tables, `import/dev/` and `import/prod/` folder convention)
- Auto-calling import procedures (no more `loader.sql`)
- Updated `dbd inspect` warnings (missing import procedures)
- Updated `dbd import --dry-run` (shows both `\copy` and `call` lines)
- New: `dbd reset` and `dbd grants` commands
- New: `schemas:` grants format in `design.yaml`

The quickstart `README.md` still references `loader.sql` in the scaffolded project structure — that file no longer exists in `example/`.

**`--environment` default:** The global option default shown in `04-commands.md` says `development` but the code default is `prod`.

- [ ] **Step 1: Update `README.md`**

Find and remove the `loader.sql` line from the project structure in the quickstart section:

```
  import/                  # Staging data files
    staging/
      lookups.csv
      lookup_values.csv
    loader.sql             # Post-import SQL    ← DELETE THIS LINE
```

Add a `dbd reset` entry to the commands table (find the table with `| dbd import  | Load seed/staging files         |`):

```
| dbd reset   | Drop schemas to bare state      |
| dbd grants  | Apply PostgREST schema grants   |
```

Update the import section (step 6) to mention that import procedures are called automatically:

````
## 6. Load staging data

```sh
dbd import
````

Reads files from `import/<schema>/` and loads them. After each CSV load, calls the matching `staging.import_<name>()` procedure if it exists. Run with `-e dev` or `-e prod` to load environment-specific tables.

```

Add a section for `dbd reset`:

```

## 10. Reset database (development)

```sh
dbd reset                    # Supabase-safe: drops user schemas only
dbd reset --target postgres  # Full reset including roles
dbd reset --dry-run          # Preview what would be dropped
```

Returns the database to a bare state. Run `dbd apply` afterward to rebuild.

## 11. Apply Supabase grants

```sh
dbd grants            # Apply grants declared in design.yaml
dbd grants --dry-run  # Preview grants SQL
```

Required when using Supabase to expose schemas through the PostgREST API layer.
Configure per-schema in `design.yaml` under each schema entry.

````

- [ ] **Step 2: Update `docs/llms/02-design-yaml.md`**

Find the `schemas:` section and replace it with the new format showing grants:

```yaml
schemas:                    # Schemas to CREATE; can include Supabase grants
  - config:                 # Object form: with grants
      grants:
        anon: [usage, select]        # GRANT USAGE + SELECT ON ALL TABLES
        authenticated: [usage, select]
        service_role: [usage, all]   # GRANT USAGE + ALL ON ALL TABLES
  - extensions              # String form: no grants (unchanged)
  - staging
  - migrate
````

Add a note: "Grants are applied by `dbd grants --target supabase`. Valid permission values: `usage`, `select`, `insert`, `update`, `delete`, `all`."

Also remove the `loader.sql` reference from the `import.after` example (or add a note that loader.sql is no longer needed — import procedures are called automatically).

- [ ] **Step 3: Update `docs/llms/04-commands.md`**

Fix the `--environment` global option default from `development` to `prod`.

Add `reset` command entry after `export`:

````markdown
## `dbd reset`

Drop all schemas declared in `design.yaml`, returning the database to a bare state. Run `dbd apply` to rebuild.

```sh
dbd reset                            # Supabase-safe (default)
dbd reset --target postgres          # Full reset: drops schemas and roles
dbd reset --dry-run                  # Print what would be dropped
```
````

**`--target supabase` (default):** Drops only user-defined schemas. Supabase-managed schemas (`auth`, `storage`, `realtime`, etc.) are never touched. Roles are not dropped.

**`--target postgres`:** Drops all design.yaml schemas and roles (roles in reverse dependency order).

After reset, the database has no schemas. Run `dbd apply` to rebuild.

---

## `dbd grants`

Apply schema-level grants declared in `design.yaml` to Supabase PostgREST roles.

```sh
dbd grants                           # Apply all configured grants
dbd grants --dry-run                 # Print what would be granted
```

No-op when `--target postgres` (prints info message).

Grants must be declared per-schema in `design.yaml`:

```yaml
schemas:
  - config:
      grants:
        anon: [usage, select]
        service_role: [usage, all]
```

For each grant entry, generates:

- `GRANT USAGE ON SCHEMA` (for `usage`)
- `GRANT ... ON ALL TABLES IN SCHEMA` (for table-level perms)
- `ALTER DEFAULT PRIVILEGES IN SCHEMA GRANT ... ON TABLES` (for future tables)

````

Update the `dbd import` command entry:
- Fix `--environment` default to `prod`
- Update dry-run output description: "Prints the `\copy` script for each table and the `call <procedure>()` statement if an import procedure exists"
- Update execution order section: after each table import, calls `staging.import_<name>()` procedure automatically if it exists; `loader.sql` is no longer used

- [ ] **Step 4: Update `docs/llms/05-import-export.md`**

Remove all references to `loader.sql`. The file no longer exists in example projects.

Replace the `loader.sql` example in the `Post-import SQL (import.after)` section with a note:

```markdown
### Import procedures (automatic)

After each staging table is imported, dbd automatically calls `staging.import_<tablename>()` if that procedure exists. No configuration needed — it follows the naming convention.

For `staging.lookup_values` → calls `staging.import_lookup_values()` (if it exists).

A warning is shown in `dbd inspect` if a staging table has no matching import procedure.

### Post-import SQL (`import.after`)

For post-import SQL that is not a staging procedure, use `import.after`:

```yaml
import:
  after:
    - import/custom-cleanup.sql
````

```

Update the file layout example to remove `loader.sql`:

```

import/
staging/
lookup_values.csv
lookups.tsv

````

Update the environment-aware import section. Add a new section if it doesn't exist:

```markdown
### Environment-aware imports

Place files in environment subfolders for dev/prod-specific data:

````

import/
dev/
staging/
fixtures.csv # loaded only with -e dev
prod/
staging/
seeds.csv # loaded only with -e prod
staging/
lookups.csv # loaded in all environments (shared)

````

Control which environment loads with `dbd import -e dev` or `dbd import -e prod`.

Declare specific tables with env restrictions in `design.yaml`:

```yaml
import:
  tables:
    - staging.lookup_values:
        env: [dev, prod]   # shared (both envs)
    - staging.fixtures:
        env: dev           # dev only
````

````

Update the dry-run section to show both `\copy` and `call` lines:

```markdown
### Running import

```sh
dbd import --dry-run    # Shows \copy script AND call proc() for each table
````

Dry-run output example:

```
[dry-run] import: staging.lookup_values
\copy staging.lookup_values (...) FROM 'import/staging/lookup_values.csv' ...
[dry-run] call staging.import_lookup_values();
```

````

Update the end-to-end example to remove `loader.sql` and `import.after`, showing that procedures are called automatically.

- [ ] **Step 5: Run tests to confirm nothing broke**

```bash
bun run test 2>&1 | tail -10
````

Expected: all tests pass.

- [ ] **Step 6: Lint**

```bash
bun run lint 2>&1 | grep -E "error|Error" | head -20
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/llms/02-design-yaml.md docs/llms/04-commands.md docs/llms/05-import-export.md
git commit -m "docs: update README and llms docs for reset, grants, auto-procedures, env-aware import"
```
