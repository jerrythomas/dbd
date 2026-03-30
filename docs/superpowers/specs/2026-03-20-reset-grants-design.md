# Design: Reset and Grants Commands

**Date:** 2026-03-20
**Status:** Approved

## Problem

Two gaps in the current dbd workflow:

1. **No reset command.** There is no way to tear down the database schemas defined in `design.yaml` and return to a clean slate. Users must write DROP statements manually.

2. **No Supabase grant support.** When targeting Supabase, schemas must be explicitly granted to PostgREST roles (`anon`, `authenticated`, `service_role`) to be accessible through the API layer. There is no mechanism to declare or apply these grants.

Additionally, Supabase imposes constraints that plain PostgreSQL does not — internal schemas (`auth`, `storage`, `realtime`, etc.) must never be dropped, and roles are managed by Supabase rather than the project.

## Solution

Add two new commands:

- **`dbd reset`** — drops all `design.yaml`-defined schemas, Supabase-safe by default
- **`dbd grants`** — applies schema-level grants declared in `design.yaml`, Supabase-only

Both commands share a `--target` flag (`supabase` | `postgres`, default: `supabase`) to control behavior. The default is the safer option; `--target postgres` is an intentional override.

Grant configuration is declared per-schema in `design.yaml`. SQL generation is handled by pure functions following the existing `importScriptForEntity` / `exportScriptForEntity` pattern.

## `--target` Flag

Both commands accept:

```sh
--target supabase   # Default — Supabase-safe behavior
--target postgres   # Full drop/no-op on grants
```

The flag is on each command, not global, because other commands (`apply`, `import`) are not target-sensitive.

## `dbd reset` Behavior

| Target     | Schemas                                                                        | Roles                                               |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `supabase` | `DROP SCHEMA IF EXISTS x CASCADE` for schemas not in `SUPABASE_PROTECTED` list | Skipped (Supabase manages roles)                    |
| `postgres` | `DROP SCHEMA IF EXISTS x CASCADE` for all design.yaml schemas                  | `DROP ROLE IF EXISTS x` in reverse dependency order |

Supabase-protected schemas (never touched):

```js
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
```

After reset, the database is in a bare state. Users run `dbd apply` to rebuild.

## `dbd grants` Behavior

| Target     | Action                                            |
| ---------- | ------------------------------------------------- |
| `supabase` | Apply grants declared per schema in `design.yaml` |
| `postgres` | No-op — prints info message, exits cleanly        |

For each schema with grants declared, the generated SQL:

1. `GRANT USAGE ON SCHEMA <name> TO <role>` (if `usage` in perms)
2. `GRANT <PRIVS> ON ALL TABLES IN SCHEMA <name> TO <role>` (table-level privs)
3. `ALTER DEFAULT PRIVILEGES IN SCHEMA <name> GRANT <PRIVS> ON TABLES TO <role>` (future tables)

## `design.yaml` Schema Grants Format

Schemas now accept either a string (existing) or an object with an optional `grants` key:

```yaml
schemas:
  - config:
      grants:
        anon: [usage, select]
        authenticated: [usage, select]
        service_role: [usage, all]
  - extensions
  - staging
  - migrate:
      grants:
        service_role: [usage, all]
```

Grant values:

| Value    | PostgreSQL privilege                                        |
| -------- | ----------------------------------------------------------- |
| `usage`  | `GRANT USAGE ON SCHEMA`                                     |
| `select` | `GRANT SELECT ON ALL TABLES IN SCHEMA` + default privileges |
| `insert` | `GRANT INSERT ON ALL TABLES IN SCHEMA` + default privileges |
| `update` | `GRANT UPDATE ON ALL TABLES IN SCHEMA` + default privileges |
| `delete` | `GRANT DELETE ON ALL TABLES IN SCHEMA` + default privileges |
| `all`    | `GRANT ALL ON ALL TABLES IN SCHEMA` + default privileges    |

Schemas without `grants` declared are skipped by `dbd grants` (no warning).

## Pure Functions — `packages/db/src/script-builder.js`

### `buildResetScript(schemas, roles, target)`

`schemas` is `string[]` (schema names). `roles` is an array of role objects with `.name` (pre-sorted by dependency; reversed here for correct drop order).

```js
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
```

### `buildGrantsScript(schemaGrants, target)`

`schemaGrants` is the `config.schemaGrants` array — only schemas that have grants declared.

```js
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

## `config.js` — `normalizeSchema(entry)` and `schemaGrants`

`normalizeSchema` parses a single schema entry from `design.yaml`:

```js
const VALID_GRANT_PERMS = ['usage', 'select', 'insert', 'update', 'delete', 'all']

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

**`config.schemas` stays as `string[]`** — no existing callsites change. A new `config.schemaGrants` field carries the grants data:

```js
// In read() after parsing YAML:
const normalized = (data.schemas || []).map(normalizeSchema)
return {
  ...data,
  schemas: normalized.map((s) => s.name), // string[] — unchanged shape
  schemaGrants: normalized.filter((s) => s.grants) // [{ name, grants }]
}
```

`clean()`, `entityFromSchemaName`, and all existing consumers of `config.schemas` are unchanged. No existing tests need updating for schema shape.

## `design.js` — New Methods

### `reset(target, dryRun)`

`this.#config.schemas` is `string[]` — passed directly to `buildResetScript`. `this.#config.roles` is pre-sorted by `sortByDependencies`; `.reverse()` in `buildResetScript` gives correct drop order.

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
```

### `grants(target, dryRun)`

`this.#config.schemaGrants` is `[{ name, grants }]` — only schemas with grants declared.

```js
async grants(target = 'supabase', dryRun = false) {
  const script = buildGrantsScript(this.#config.schemaGrants, target)
  if (!script) {
    console.info(target === 'postgres'
      ? 'Grants are not applicable for --target postgres'
      : 'No grants configured in design.yaml')
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

Both methods print their own success message after `executeScript`. No-op paths (empty script, postgres target) print an informational message and return without calling the adapter. `index.js` actions print nothing — all output is owned by the method.

## CLI Commands — `index.js`

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

All success/info/no-op messages are handled inside `reset()` and `grants()`, not in `index.js`. This avoids printing "Reset complete." or "Grants applied." when the method did nothing (empty schemas, no grants configured, postgres target).

## Documentation Updates

The following docs require updates in the same plan (all features since v2.1.0):

| Doc                             | Updates needed                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                     | Add `dbd reset`, `dbd grants`; remove `loader.sql` from quickstart; add env-aware import (`-e`); update import section to show auto-procedure behavior  |
| `docs/llms/04-commands.md`      | Add `reset` and `grants` command entries; fix `import` dry-run description; fix `--environment` default (`prod` not `development`)                      |
| `docs/llms/05-import-export.md` | Remove `loader.sql` references; document `env:` in design.yaml import tables; document auto-procedure calls; document dev/prod/shared import separation |

## Files Changed

| File                                      | Change                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/script-builder.js`       | New — `buildResetScript`, `buildGrantsScript`, `SUPABASE_PROTECTED`                                                   |
| `packages/db/src/index.js`                | Export `buildResetScript`, `buildGrantsScript`                                                                        |
| `packages/cli/src/config.js`              | Add `normalizeSchema()`, `VALID_GRANT_PERMS`; call in `read()` to populate `schemaGrants`; `schemas` stays `string[]` |
| `packages/cli/src/design.js`              | Add `reset()` and `grants()` methods; no changes to existing schema consumers                                         |
| `packages/cli/src/index.js`               | Add `reset` and `grants` commands                                                                                     |
| `packages/db/spec/script-builder.spec.js` | Unit tests for `buildResetScript` and `buildGrantsScript`                                                             |
| `packages/cli/spec/design.spec.js`        | Tests for `reset()` and `grants()`                                                                                    |
| `packages/cli/spec/config.spec.js`        | Tests for `normalizeSchema()`                                                                                         |
| `example/design.yaml`                     | Add grants example for `config` schema                                                                                |
| `README.md`                               | Full doc update                                                                                                       |
| `docs/llms/04-commands.md`                | Command reference update                                                                                              |
| `docs/llms/05-import-export.md`           | Import/export doc update                                                                                              |

## Testing

**`script-builder.spec.js` — `buildResetScript`:**

- Supabase target: protected schemas skipped, user schemas dropped
- Supabase target: only protected schemas → returns `''`
- Supabase target: mix of protected + user schemas → only user schemas in output
- Postgres target: all schemas dropped, roles dropped in reverse order
- Empty schemas array: returns `''`
- Roles are reversed (pre-sorted input, verify order in output)

**`script-builder.spec.js` — `buildGrantsScript`:**

- Supabase target with grants: generates `GRANT USAGE`, `GRANT ... ON ALL TABLES`, `ALTER DEFAULT PRIVILEGES`
- Postgres target: returns `''` regardless of grants
- Schema without grants: skipped
- All permission types (`select`, `insert`, `update`, `delete`, `all`, `usage`)
- Empty `schemaGrants` array: returns `''`

**`config.spec.js` — `normalizeSchema`:**

- String entry: `{ name: 'config', grants: null }`
- Object entry with grants: `{ name: 'config', grants: { anon: ['usage', 'select'] } }`
- Object entry without grants key: `{ name: 'config', grants: null }`
- Invalid permission value: throws with descriptive message
- `config.schemas` after `read()` is still `string[]` — existing `toContain('config')` assertions pass unchanged

**`design.spec.js`:**

- `reset()` dry-run: prints script containing expected DROP statements
- `reset()` supabase: protected schemas absent from dry-run output
- `reset()` empty schemas: prints 'No schemas to reset.' without calling adapter
- `grants()` dry-run: prints expected GRANT statements
- `grants()` postgres target: prints info message, no adapter call
- `grants()` no schemaGrants configured: prints 'No grants configured' message
