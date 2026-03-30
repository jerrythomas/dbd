/**
 * Config loading benchmarks — measures design.yaml reading and entity processing.
 *
 * Covers:
 *   - Raw YAML read + DDL file scan
 *   - Entity script parsing (via adapter)
 *   - Full clean() with reference matching
 *   - Dependency sort
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { bench, describe, beforeAll } from 'vitest'
import { read, clean } from '../packages/cli/src/config.js'
import { matchReferences } from '../packages/cli/src/references.js'
import { sortByDependencies } from '../packages/db/src/index.js'
import { initParser } from '../packages/postgres/src/parser/parsers/sql.js'
import { PsqlAdapter } from '../packages/postgres/src/psql-adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(__dirname, '../example')
const configFile = join(exampleDir, 'design.yaml')

let adapter
let rawConfig

beforeAll(async () => {
	await initParser()
	adapter = new PsqlAdapter(null, {})
	// Pre-read raw config once; used as input for clean() benchmarks
	process.chdir(exampleDir)
	rawConfig = read(configFile)
})

describe('config loading', () => {
	bench('read() — YAML parse + DDL file scan', () => {
		read(configFile)
	})

	bench('clean() — entity parse + reference matching', () => {
		const parseEntity = (entity) => adapter.parseEntityScript(entity)
		const matchRefs = (entities, exts) =>
			matchReferences(entities, exts, (name, installed) =>
				adapter.classifyReference(name, installed)
			)
		clean(rawConfig, parseEntity, matchRefs)
	})

	bench('sortByDependencies — entities only', () => {
		sortByDependencies(rawConfig.entities)
	})
})
