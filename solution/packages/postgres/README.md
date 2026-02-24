# @jerrythomas/dbd-postgres-adapter

PostgreSQL adapter for [dbd](https://www.npmjs.com/package/@jerrythomas/dbd). Provides SQL parsing, reference classification, and database operations via `psql`.

## Features

- PostgreSQL adapter using `psql` CLI for apply, import, and export
- SQL parser using [pgsql-parser](https://www.npmjs.com/package/pgsql-parser) (PostgreSQL C parser via WASM)
- Schema extraction — tables, views, procedures, indexes, dependencies
- Reference classifier — distinguishes internal, PostgreSQL built-in, ANSI SQL, and extension references

## Usage

```js
import { createAdapter } from '@jerrythomas/dbd-postgres-adapter'

const adapter = createAdapter('postgres://localhost:5432/mydb', { verbose: true })
await adapter.apply(entity)
await adapter.importData(entity)
await adapter.exportData(entity)
```

### Parser API

```js
import { parseSchema, extractTables, extractDependencies } from '@jerrythomas/dbd-postgres-adapter'

const schema = parseSchema(sqlString)
const tables = extractTables(sqlString)
const deps = extractDependencies(sqlString)
```

### Reference Classifier

```js
import { isInternal, isPostgres, isExtension } from '@jerrythomas/dbd-postgres-adapter'

isInternal('public.users')   // true if defined in project
isPostgres('pg_catalog')     // true
isExtension('uuid_generate_v4') // true if known extension function
```

## License

MIT
