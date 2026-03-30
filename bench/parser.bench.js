/**
 * Parser benchmarks — measures DDL parsing throughput.
 *
 * Uses the postgres adapter parser (pgsql-parser WASM).
 * WASM is initialized once in beforeAll; individual parse calls are hot.
 *
 * Covers:
 *   - Raw SQL → AST (parse only)
 *   - SQL → entity with dependencies (full extractDependencies)
 *   - Bulk: all 11 example DDL files
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bench, describe, beforeAll } from 'vitest'
import { initParser, parse as parseSQL } from '../packages/postgres/src/parser/parsers/sql.js'
import { extractDependencies } from '../packages/postgres/src/parser/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDdl = join(__dirname, '../example/ddl')

const read = (p) => readFileSync(p, 'utf-8')

const DDL = {
	tableSimple: read(join(exampleDdl, 'table/config/lookups.ddl')),
	tableWithRefs: read(join(exampleDdl, 'table/config/lookup_values.ddl')),
	tableSelfRef: read(join(exampleDdl, 'table/config/categories.ddl')),
	view: read(join(exampleDdl, 'view/config/genders.ddl')),
	procedure: read(join(exampleDdl, 'procedure/staging/import_lookups.ddl'))
}

const ALL_FILES = [
	'table/config/categories.ddl',
	'table/config/lookups.ddl',
	'table/config/lookup_values.ddl',
	'table/staging/lookups.ddl',
	'table/staging/lookup_values.ddl',
	'view/config/genders.ddl',
	'view/config/range_values.ddl',
	'view/migrate/lookup_values.ddl',
	'procedure/staging/import_jsonb_to_table.ddl',
	'procedure/staging/import_lookups.ddl',
	'procedure/staging/import_lookup_values.ddl'
].map((f) => read(join(exampleDdl, f)))

beforeAll(async () => {
	await initParser()
})

describe('parse to AST', () => {
	bench('table — simple', () => {
		parseSQL(DDL.tableSimple)
	})

	bench('table — FK references', () => {
		parseSQL(DDL.tableWithRefs)
	})

	bench('table — self-referencing FK', () => {
		parseSQL(DDL.tableSelfRef)
	})

	bench('view', () => {
		parseSQL(DDL.view)
	})

	bench('procedure', () => {
		parseSQL(DDL.procedure)
	})
})

describe('extract dependencies (full parse pipeline)', () => {
	bench('table — simple', () => {
		extractDependencies(DDL.tableSimple)
	})

	bench('table — FK references', () => {
		extractDependencies(DDL.tableWithRefs)
	})

	bench('view', () => {
		extractDependencies(DDL.view)
	})

	bench('procedure', () => {
		extractDependencies(DDL.procedure)
	})
})

describe('bulk parse', () => {
	bench('all 11 example DDL files', () => {
		for (const content of ALL_FILES) {
			extractDependencies(content)
		}
	})
})
