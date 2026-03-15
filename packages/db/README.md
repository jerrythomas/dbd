# @jerrythomas/dbd-db

Database operations abstraction layer for [dbd](https://www.npmjs.com/package/@jerrythomas/dbd). Provides entity processing, dependency resolution, and a database adapter factory.

## Features

- Base database adapter with common operations (apply, import, export)
- Entity processing — create entities from files, schemas, roles, extensions
- DDL generation and script combination
- Dependency graph builder with cycle detection and topological sorting
- Adapter factory with plugin registration

## Usage

```js
import { createAdapter, entityFromFile, sortByDependencies } from '@jerrythomas/dbd-db'

// Create a database adapter
const adapter = await createAdapter('postgres', connectionString, options)

// Process entities and resolve dependencies
const entity = entityFromFile('tables', 'public', 'users.sql')
const sorted = sortByDependencies(entities)
```

## API

### Adapter Factory

- `createAdapter(dialect, connectionString, options)` — create a dialect-specific adapter
- `registerAdapter(dialect, factory)` — register a custom adapter
- `getAdapterInfo()` — list registered adapters

### Entity Processing

- `entityFromFile(type, schema, file)` — create entity from a DDL file
- `entityFromSchemaName(schema)` — create schema entity
- `entityFromRoleName(role)` — create role entity
- `ddlFromEntity(entity)` — generate DDL from entity
- `combineEntityScripts(entities)` — combine into single script
- `validateEntity(entity)` / `getValidEntities(entities)` / `getInvalidEntities(entities)`

### Dependency Resolution

- `buildDependencyGraph(entities)` — build directed dependency graph
- `findCycles(graph)` — detect circular dependencies
- `sortByDependencies(entities)` — topological sort
- `groupByDependencyLevel(entities)` — group for parallel execution

## License

MIT
