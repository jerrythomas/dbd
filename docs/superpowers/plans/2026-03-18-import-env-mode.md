# Import Environment Mode (dev/prod) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dev/prod environment mode to import so different tables and post-import scripts run per environment, with `prod` as default.

**Architecture:** `normalizeEnv()` maps CLI input to `'dev'`/`'prod'`. `cleanImportTables()` annotates entities with env from folder path (position-aware: `import/dev/...` or `import/prod/...`) or from YAML `env:` field. `Design` stores `#env` and filters import tables in `validate()`. `importData()` runs env-scoped `after` scripts.

**Tech Stack:** Node.js ES modules, Ramda, vitest, sade (CLI), js-yaml

---

## Chunk 1: `normalizeEnv` utility and config annotation

### Task 1: `normalizeEnv` — failing tests first

**Files:**

- Modify: `packages/cli/spec/config.spec.js`
- Modify: `packages/cli/src/config.js`

- [ ] **Step 1: Write the failing tests for `normalizeEnv`**

Add `normalizeEnv` to the import line at the top of `packages/cli/spec/config.spec.js`:

```js
import { scan, read, clean, merge, normalizeEnv } from '../src/config.js'
```

Add a new `describe` block:

```js
describe('normalizeEnv', () => {
  it('maps "prod" to "prod"', () => {
    expect(normalizeEnv('prod')).toBe('prod')
  })
  it('maps "production" to "prod"', () => {
    expect(normalizeEnv('production')).toBe('prod')
  })
  it('maps "dev" to "dev"', () => {
    expect(normalizeEnv('dev')).toBe('dev')
  })
  it('maps "development" to "dev"', () => {
    expect(normalizeEnv('development')).toBe('dev')
  })
  it('returns "prod" for undefined', () => {
    expect(normalizeEnv(undefined)).toBe('prod')
  })
  it('returns "prod" for null', () => {
    expect(normalizeEnv(null)).toBe('prod')
  })
  it('throws for unrecognized value', () => {
    expect(() => normalizeEnv('staging')).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `normalizeEnv is not a function`

- [ ] **Step 3: Implement `normalizeEnv` in `packages/cli/src/config.js`**

Add near the top of the file (after imports):

```js
const ENV_ALIASES = {
  prod: 'prod',
  production: 'prod',
  dev: 'dev',
  development: 'dev'
}

/**
 * Normalizes environment string to 'dev' or 'prod'.
 * Returns 'prod' for null/undefined. Throws for unrecognized values.
 *
 * @param {string|null|undefined} value
 * @returns {'dev'|'prod'}
 */
export function normalizeEnv(value) {
  if (value == null) return 'prod'
  const normalized = ENV_ALIASES[value]
  if (!normalized)
    throw new Error(`Unknown environment: "${value}". Use dev, development, prod, or production.`)
  return normalized
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all `normalizeEnv` tests PASS, all existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.js packages/cli/spec/config.spec.js
git commit -m "feat(cli): add normalizeEnv utility"
```

---

### Task 2: Env annotation in `cleanImportTables` — folder-based

**Files:**

- Modify: `packages/cli/src/config.js`
- Modify: `packages/cli/spec/config.spec.js`
- Create: `example/import/dev/staging/dev_fixtures.csv`
- Create: `example/import/prod/staging/prod_seeds.csv`

**Note:** `envFromPath` uses position-aware detection: `parts[1] === 'dev'` (since `scan('import')` produces `import/...` paths). This avoids false matches from filenames like `import/staging/dev_data.csv`.

- [ ] **Step 1: Add fixture CSV files for env folders**

Create `example/import/dev/staging/dev_fixtures.csv`:

```
id,label
1,dev-only
```

Create `example/import/prod/staging/prod_seeds.csv`:

```
id,label
1,prod-only
```

- [ ] **Step 2: Write failing tests for folder-based env annotation**

Use the same `parseEntity`/`matchRefs` stub pattern already used in `config.spec.js`. Add a new describe block:

```js
describe('cleanImportTables env annotation (folder-based)', () => {
  const parseEntity = (entity) => ({
    ...entity,
    searchPaths: ['public'],
    references: [],
    errors: []
  })
  const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

  beforeEach(() => process.chdir(exampleDir))

  it('annotates files under import/dev/ with env "dev"', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    const devTable = result.importTables.find((t) => t.name === 'staging.dev_fixtures')
    expect(devTable).toBeDefined()
    expect(devTable.env).toBe('dev')
  })

  it('annotates files under import/prod/ with env "prod"', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    const prodTable = result.importTables.find((t) => t.name === 'staging.prod_seeds')
    expect(prodTable).toBeDefined()
    expect(prodTable.env).toBe('prod')
  })

  it('annotates ungrouped import files with env null (shared)', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    // staging.lookups is at import/staging/lookups.csv — no dev/prod parent folder
    const sharedTable = result.importTables.find((t) => t.name === 'staging.lookups')
    expect(sharedTable).toBeDefined()
    expect(sharedTable.env).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `env` is undefined on entities

- [ ] **Step 4: Add helpers and update `cleanImportTables` in `config.js`**

Add `envFromPath` above `cleanImportTables`. The `scan('import')` function always produces paths like `import/...`, so `parts[1]` is the first subfolder:

```js
/**
 * Derives import env from a file path by checking the second path segment.
 * scan('import') produces paths like 'import/dev/...', 'import/prod/...', 'import/staging/...'
 * Returns null for shared (ungrouped) files.
 *
 * @param {string} filePath
 * @returns {'dev'|'prod'|null}
 */
function envFromPath(filePath) {
  const parts = filePath.split('/')
  if (parts[1] === 'dev') return 'dev'
  if (parts[1] === 'prod') return 'prod'
  return null
}
```

Update the scan chain inside `cleanImportTables` to annotate env:

```js
// Before:
let importTables = scan('import')
  .filter((file) => ['.jsonl', '.csv', '.tsv'].includes(extname(file)))
  .map((file) => ({ ...options, ...entityFromFile(file) }))
  .map((table) => ({ ...table, ...schemaOptions[table.schema] }))

// After:
let importTables = scan('import')
  .filter((file) => ['.jsonl', '.csv', '.tsv'].includes(extname(file)))
  .map((file) => ({ ...options, ...entityFromFile(file), env: envFromPath(file) }))
  .map((table) => ({ ...table, ...schemaOptions[table.schema] }))
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all new env annotation tests PASS, all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/config.js packages/cli/spec/config.spec.js example/import/dev/staging/dev_fixtures.csv example/import/prod/staging/prod_seeds.csv
git commit -m "feat(cli): annotate import entities with env from folder path"
```

---

### Task 3: Env annotation from YAML `env:` field

**Files:**

- Modify: `packages/cli/src/config.js`
- Modify: `packages/cli/spec/config.spec.js`
- Modify: `example/design.yaml`
- Create: `example/import/staging/dev_fixture_table.csv`

- [ ] **Step 1: Write failing tests for YAML env annotation**

Add a new describe block to `packages/cli/spec/config.spec.js`:

```js
describe('cleanImportTables env annotation (YAML)', () => {
  const parseEntity = (entity) => ({
    ...entity,
    searchPaths: ['public'],
    references: [],
    errors: []
  })
  const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

  beforeEach(() => process.chdir(exampleDir))

  it('annotates YAML-listed table with env "dev" when env field is "dev"', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    // staging.dev_fixture_table is in import.tables with env: dev
    const table = result.importTables.find((t) => t.name === 'staging.dev_fixture_table')
    expect(table).toBeDefined()
    expect(table.env).toBe('dev')
  })

  it('annotates YAML-listed table with env null when env is [dev, prod] (explicit shared)', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    // staging.lookup_values has env: [dev, prod] in design.yaml → shared
    const table = result.importTables.find((t) => t.name === 'staging.lookup_values')
    expect(table).toBeDefined()
    expect(table.env).toBeNull()
  })

  it('annotates YAML-listed table with env null when no env field (implicitly shared)', () => {
    const data = read('design.yaml')
    const result = clean(data, parseEntity, matchRefs)
    // staging.lookups is discovered from filesystem with no YAML entry → env from path = null
    const table = result.importTables.find((t) => t.name === 'staging.lookups')
    expect(table).toBeDefined()
    expect(table.env).toBeNull()
  })
})
```

- [ ] **Step 2: Update `example/design.yaml` import.tables with env-tagged entries**

```yaml
import:
  options:
    truncate: true
    nullValue: ''
  tables:
    - staging.lookup_values:
        env: [dev, prod]
    - staging.dev_fixture_table:
        env: dev
  after:
    - import/loader.sql
```

Create the matching empty CSV `example/import/staging/dev_fixture_table.csv`:

```
id,label
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `table.env` is undefined for YAML-listed entries

- [ ] **Step 4: Add `normalizeYamlEnv` and update the YAML merge path in `cleanImportTables`**

Add `normalizeYamlEnv` helper after `normalizeEnv`:

```js
/**
 * Normalizes the env field from a YAML table entry.
 * An array containing both dev and prod aliases → null (shared).
 * A single value → normalize. Absent → null.
 *
 * @param {string|string[]|undefined} value
 * @returns {'dev'|'prod'|null}
 */
function normalizeYamlEnv(value) {
  if (value == null) return null
  if (Array.isArray(value)) {
    const normalized = [...new Set(value.map(normalizeEnv))]
    return normalized.length === 2 ? null : normalized[0]
  }
  return normalizeEnv(value)
}
```

Update the YAML table merge inside `cleanImportTables`:

```js
// Before:
importTables = merge(
  importTables,
  tables.map((table) => entityFromImportConfig(table, options))
)

// After:
importTables = merge(
  importTables,
  tables.map((table) => {
    const entity = entityFromImportConfig(table, options)
    const rawEnv = typeof table === 'object' ? Object.values(table)[0]?.env : null
    entity.env = normalizeYamlEnv(rawEnv)
    return entity
  })
)
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all YAML env annotation tests PASS, all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/config.js packages/cli/spec/config.spec.js example/design.yaml example/import/staging/dev_fixture_table.csv
git commit -m "feat(cli): annotate YAML import table entries with env field"
```

---

## Chunk 2: Design class env filtering and after scripts

### Task 4: Design class — store `#env`, filter in `validate()`

**Files:**

- Modify: `packages/cli/src/design.js`
- Modify: `packages/cli/spec/design.spec.js`

**Prerequisite:** Tasks 1–3 must be complete (fixture files from Task 2 must exist in `example/`).

- [ ] **Step 1: Write failing tests for env filtering**

Add a new describe block to `packages/cli/spec/design.spec.js`. The `using()` import at the top of the file already points to `'../src/design.js'`:

```js
describe('Design env filtering', () => {
  let originalDir

  beforeAll(() => {
    originalDir = process.cwd()
    process.chdir(join(__dirname, '../../../example'))
  })

  afterAll(() => {
    process.chdir(originalDir)
  })

  it('defaults to prod env when no env arg given', async () => {
    const dx = await using('design.yaml')
    dx.validate()
    const devTable = dx.importTables.find((t) => t.name === 'staging.dev_fixtures')
    expect(devTable).toBeUndefined()
  })

  it('includes shared tables in prod env', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    dx.validate()
    const shared = dx.importTables.find((t) => t.name === 'staging.lookups')
    expect(shared).toBeDefined()
  })

  it('excludes dev-only folder table when env is prod', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    dx.validate()
    const devTable = dx.importTables.find((t) => t.name === 'staging.dev_fixtures')
    expect(devTable).toBeUndefined()
  })

  it('includes dev-only folder table when env is dev', async () => {
    const dx = await using('design.yaml', undefined, 'dev')
    dx.validate()
    const devTable = dx.importTables.find((t) => t.name === 'staging.dev_fixtures')
    expect(devTable).toBeDefined()
  })

  it('excludes prod-only folder table when env is dev', async () => {
    const dx = await using('design.yaml', undefined, 'dev')
    dx.validate()
    const prodTable = dx.importTables.find((t) => t.name === 'staging.prod_seeds')
    expect(prodTable).toBeUndefined()
  })

  it('includes prod-only folder table when env is prod', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    dx.validate()
    const prodTable = dx.importTables.find((t) => t.name === 'staging.prod_seeds')
    expect(prodTable).toBeDefined()
  })

  it('excludes dev YAML table when env is prod', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    dx.validate()
    const devYaml = dx.importTables.find((t) => t.name === 'staging.dev_fixture_table')
    expect(devYaml).toBeUndefined()
  })

  it('includes dev YAML table when env is dev', async () => {
    const dx = await using('design.yaml', undefined, 'dev')
    dx.validate()
    const devYaml = dx.importTables.find((t) => t.name === 'staging.dev_fixture_table')
    expect(devYaml).toBeDefined()
  })

  it('applies env filter in dry-run mode too', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    const infoCalls = []
    vi.spyOn(console, 'info').mockImplementation((msg) => infoCalls.push(msg))
    dx.importData(undefined, true)
    vi.restoreAllMocks()
    const names = infoCalls
      .filter((m) => m.startsWith('Importing'))
      .map((m) => m.replace('Importing ', ''))
    expect(names).not.toContain('staging.dev_fixtures')
    expect(names).not.toContain('staging.dev_fixture_table')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `using` doesn't accept a third argument

- [ ] **Step 3: Update `Design` class to store `#env` and filter in `validate()`**

In `packages/cli/src/design.js`:

1. Add `#env` private field:

```js
class Design {
  #config = {}
  #roles = []
  #entities = []
  #isValidated = false
  #databaseURL
  #importTables
  #adapter = null
  #env = 'prod'
```

2. Update constructor signature to accept `env`:

```js
constructor(rawConfig, adapter, databaseURL, env = 'prod') {
  // ... all existing code unchanged ...
  this.#env = env
}
```

3. Update `validate()` — add env filter as the first filter before `validateEntity`:

```js
validate() {
  const allowedSchemas = this.#config.project.staging

  this.#roles = this.config.roles.map((role) => validateEntity(role))
  this.#entities = this.entities.map((entity) => validateEntity(entity, true, this.config.ignore))
  this.#importTables = this.importTables
    .filter((entity) => entity.env === null || entity.env === this.#env)
    .map((entity) => validateEntity(entity, false))
    .map((entity) => {
      if (!allowedSchemas.includes(entity.schema))
        entity.errors = [...(entity.errors || []), 'Import is only allowed for staging schemas']
      return entity
    })

  this.#isValidated = true
  return this
}
```

4. Update `using()` factory at the bottom of the file:

```js
export async function using(file, databaseURL, env = 'prod') {
  const rawConfig = read(file)
  const dbType = rawConfig.project?.database || 'PostgreSQL'
  const { createAdapter, registerAdapter } = await import('@jerrythomas/dbd-db')
  registerAdapter('postgres', () => import('@jerrythomas/dbd-postgres-adapter'))
  registerAdapter('postgresql', () => import('@jerrythomas/dbd-postgres-adapter'))
  const adapter = await createAdapter(dbType.toLowerCase(), databaseURL)
  await adapter.initParser()
  return new Design(rawConfig, adapter, databaseURL, env)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all new env filtering tests PASS, all existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): add env filtering to Design class and using() factory"
```

---

### Task 5: `importData` — env-scoped `after` scripts

**Files:**

- Modify: `packages/cli/src/design.js`
- Modify: `packages/cli/spec/design.spec.js`
- Modify: `example/design.yaml`
- Create: `example/import/dev_loader.sql`
- Create: `example/import/prod_loader.sql`

**Note:** The existing test at line ~364 of `design.spec.js` asserts `execSpy.toHaveBeenCalledWith('import/loader.sql')`. After this task, `importData()` (prod env by default) will also call `executeFile('import/prod_loader.sql')`. The existing assertion uses `toHaveBeenCalledWith` (not exclusive), so it remains valid.

- [ ] **Step 1: Add env-scoped after entries to `example/design.yaml`**

```yaml
import:
  options:
    truncate: true
    nullValue: ''
  tables:
    - staging.lookup_values:
        env: [dev, prod]
    - staging.dev_fixture_table:
        env: dev
  after:
    - import/loader.sql
  after.dev:
    - import/dev_loader.sql
  after.prod:
    - import/prod_loader.sql
```

Create placeholder files:

`example/import/dev_loader.sql`:

```sql
-- dev post-import processing
```

`example/import/prod_loader.sql`:

```sql
-- prod post-import processing
```

- [ ] **Step 2: Write failing tests for env-scoped after scripts**

Add a new describe block in `packages/cli/spec/design.spec.js`:

```js
describe('importData env-scoped after scripts', () => {
  let originalDir

  beforeAll(() => {
    originalDir = process.cwd()
    process.chdir(join(__dirname, '../../../example'))
  })

  afterAll(() => {
    process.chdir(originalDir)
  })

  it('always runs shared after scripts', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    const adapter = await dx.getAdapter()
    const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
    const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
    await dx.importData()
    expect(execSpy).toHaveBeenCalledWith('import/loader.sql')
    importSpy.mockRestore()
    execSpy.mockRestore()
  })

  it('runs after.prod scripts in prod env', async () => {
    const dx = await using('design.yaml', undefined, 'prod')
    const adapter = await dx.getAdapter()
    const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
    const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
    await dx.importData()
    const calls = execSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('import/prod_loader.sql')
    expect(calls).not.toContain('import/dev_loader.sql')
    importSpy.mockRestore()
    execSpy.mockRestore()
  })

  it('runs after.dev scripts in dev env', async () => {
    const dx = await using('design.yaml', undefined, 'dev')
    const adapter = await dx.getAdapter()
    const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
    const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
    await dx.importData()
    const calls = execSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('import/dev_loader.sql')
    expect(calls).not.toContain('import/prod_loader.sql')
    importSpy.mockRestore()
    execSpy.mockRestore()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun run test:cli
```

Expected: FAIL — `after.dev`/`after.prod` scripts not executed

- [ ] **Step 4: Update `importData` to run env-scoped after scripts**

In `packages/cli/src/design.js`, update the after-script section of `importData`:

```js
// Before:
for (const file of this.config.import.after) {
  console.info(`Processing ${file}`)
  await adapter.executeFile(file)
}

// After:
const sharedAfter = this.config.import.after ?? []
const envAfter = this.config.import[`after.${this.#env}`] ?? []

for (const file of [...sharedAfter, ...envAfter]) {
  console.info(`Processing ${file}`)
  await adapter.executeFile(file)
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun run test:cli
```

Expected: all after-script tests PASS, all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/design.js packages/cli/spec/design.spec.js example/design.yaml example/import/dev_loader.sql example/import/prod_loader.sql
git commit -m "feat(cli): run env-scoped after scripts in importData"
```

---

## Chunk 3: CLI wiring and final verification

### Task 6: Wire `-e` CLI flag through to `using()`

**Files:**

- Modify: `packages/cli/src/index.js`
- Modify: `packages/cli/spec/config.spec.js` (CLI default test)

- [ ] **Step 1: Write a failing test for the CLI default and normalization**

Add to `packages/cli/spec/config.spec.js`:

```js
describe('normalizeEnv CLI defaults', () => {
  it('normalizes the CLI default value "prod" to "prod"', () => {
    // This verifies the new CLI default ('prod') is a valid normalizeEnv input
    expect(normalizeEnv('prod')).toBe('prod')
  })

  it('normalizes "development" alias to "dev" (what old CLI default would produce)', () => {
    expect(normalizeEnv('development')).toBe('dev')
  })
})
```

- [ ] **Step 2: Run tests to confirm they pass already (they use normalizeEnv from Task 1)**

```bash
bun run test:cli
```

Expected: PASS — these use the already-implemented `normalizeEnv`

- [ ] **Step 3: Import `normalizeEnv` in `index.js` and update the import command**

In `packages/cli/src/index.js`:

Add import:

```js
import { normalizeEnv } from './config.js'
```

Change the CLI default for `-e` from `'development'` to `'prod'`:

```js
// Before:
.option('-e, --environment', 'Environment to load data', 'development')

// After:
.option('-e, --environment', 'Environment to load data', 'prod')
```

Update the import command action to normalize and pass env:

```js
// Before:
.action(async (opts) => {
  await (await using(opts.config, opts.database)).importData(opts.name, opts['dry-run'])
  console.log('Import complete.')
})

// After:
.action(async (opts) => {
  const env = normalizeEnv(opts.environment)
  await (await using(opts.config, opts.database, env)).importData(opts.name, opts['dry-run'])
  console.log('Import complete.')
})
```

- [ ] **Step 4: Run all tests**

```bash
bun run test
```

Expected: all tests PASS

- [ ] **Step 5: Run lint**

```bash
bun run lint
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.js packages/cli/spec/config.spec.js
git commit -m "feat(cli): wire -e/--environment flag to import command, default prod"
```

---

### Task 7: Final verification and docs

- [ ] **Step 1: Run full test suite**

```bash
bun run test
```

Expected: all tests PASS

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: 0 errors

- [ ] **Step 3: Update `agents/journal.md`**

Append to `agents/journal.md`:

```
## 2026-03-18 — Import env mode (dev/prod)

Implemented environment-aware import:
- `normalizeEnv()` utility maps dev/development/prod/production aliases, default prod
- `envFromPath()` annotates filesystem entities (position-aware: import/dev/ or import/prod/)
- `normalizeYamlEnv()` handles YAML env: field (string, array, absent)
- `Design#env` filters import tables in validate()
- `importData()` runs shared `after`, then env-specific `after.dev`/`after.prod`
- CLI `-e` default changed from `'development'` to `'prod'`, wired through to using()
- Commits: see git log
```

- [ ] **Step 4: Commit journal update**

```bash
git add agents/journal.md
git commit -m "docs(agents): log import env mode completion"
```
