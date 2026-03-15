# @jerrythomas/dbd-dbml

DBML conversion and publishing utilities for [dbd](https://www.npmjs.com/package/@jerrythomas/dbd). Converts DDL scripts into [DBML](https://dbml.dbdiagram.io/) format for use with [dbdocs.io](https://dbdocs.io).

## Features

- Convert DDL to DBML via [@dbml/core](https://www.npmjs.com/package/@dbml/core)
- Schema-qualified table name handling
- DDL cleanup (comments, indexes, unsupported statements)
- Project block generation for dbdocs

## Usage

```js
import { generateDBML, convertToDBML } from '@jerrythomas/dbd-dbml'

// Generate DBML from a collection of entities
const dbml = generateDBML(entities, projectName)

// Convert a single DDL string
const result = convertToDBML(ddlString)
```

## API

- `generateDBML(entities, projectName)` — generate full DBML document from entities
- `convertToDBML(ddl)` — convert DDL string to DBML
- `cleanupDDLForDBML(ddl)` — strip unsupported SQL for DBML conversion
- `buildProjectBlock(name)` — generate DBML project block
- `qualifyTableNames(ddl, schema)` — add schema prefixes to table names
- `buildTableLookup(entities)` / `buildTableReplacements(lookup)` / `applyTableReplacements(dbml, replacements)`

## License

MIT
