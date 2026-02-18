/**
 * Tests for packages/cli Design class.
 *
 * Mirrors spec/compat/design.spec.js but imports from packages/cli.
 * Proves feature parity with the legacy src/collect.js Design class.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { resetCache } from '../src/references.js'
import { using } from '../src/design.js'
import { entities as expectedEntities } from './fixtures/design/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const exampleDir = join(repoRoot, 'example')

describe('Design class (packages/cli)', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	beforeEach(() => {
		resetCache()
		process.chdir(exampleDir)
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		process.chdir(originalPath)
		vi.restoreAllMocks()
	})

	// --- Initialization ---

	it('using() returns a Design instance with expected properties', () => {
		const dx = using('design.yaml')

		expect(dx).toBeDefined()
		expect(dx.config).toBeDefined()
		expect(dx.entities).toBeDefined()
		expect(dx.isValidated).toBe(false)
		expect(dx.databaseURL).toBeUndefined()
	})

	it('using() with databaseURL stores the URL', () => {
		const url = 'postgresql://localhost/test'
		const dx = using('design.yaml', url)
		expect(dx.databaseURL).toBe(url)
	})

	it('loads project config from example/design.yaml', () => {
		const dx = using('design.yaml')

		expect(dx.config.project.name).toBe('Example')
		expect(dx.config.project.database).toBe('PostgreSQL')
		expect(dx.config.project.extensionSchema).toBe('extensions')
		expect(dx.config.project.staging).toEqual(['staging'])
	})

	it('loads schemas from config', () => {
		const dx = using('design.yaml')

		expect(dx.config.schemas).toContain('config')
		expect(dx.config.schemas).toContain('extensions')
		expect(dx.config.schemas).toContain('staging')
		expect(dx.config.schemas).toContain('migrate')
	})

	it('loads extensions from config', () => {
		const dx = using('design.yaml')

		expect(dx.config.extensions).toEqual(['uuid-ossp'])
	})

	// --- Entities ---

	it('discovers correct number of entities', () => {
		const dx = using('design.yaml')
		expect(dx.entities.length).toBe(expectedEntities.length)
	})

	it('entities include schemas first, then extensions, then roles, then DDL', () => {
		const dx = using('design.yaml')
		const types = dx.entities.map((e) => e.type)

		const firstSchema = types.indexOf('schema')
		const firstExtension = types.indexOf('extension')
		const firstRole = types.indexOf('role')
		const firstTable = types.indexOf('table')

		expect(firstSchema).toBeLessThan(firstExtension)
		expect(firstExtension).toBeLessThan(firstRole)
		expect(firstRole).toBeLessThan(firstTable)
	})

	it('entity names match expected list', () => {
		const dx = using('design.yaml')
		const names = dx.entities.map((e) => e.name)
		const expectedNames = expectedEntities.map((e) => e.name)
		expect(names).toEqual(expectedNames)
	})

	// --- Validation ---

	it('validate() sets isValidated flag', () => {
		const dx = using('design.yaml')
		expect(dx.isValidated).toBe(false)
		dx.validate()
		expect(dx.isValidated).toBe(true)
	})

	it('validate() returns this (chainable)', () => {
		const dx = using('design.yaml')
		const result = dx.validate()
		expect(result).toBe(dx)
	})

	it('report() returns { entity, issues }', () => {
		const dx = using('design.yaml')
		const result = dx.report()
		expect(result).toHaveProperty('entity')
		expect(result).toHaveProperty('issues')
	})

	it('report(name) returns specific entity', () => {
		const dx = using('design.yaml')
		const result = dx.report('config.lookups')
		expect(result.entity.name).toBe('config.lookups')
	})

	// --- combine ---

	it('combine() generates DDL file', () => {
		const dx = using('design.yaml')
		const file = '_test_combined.ddl'

		try {
			dx.combine(file)
			expect(existsSync(file)).toBe(true)

			const content = readFileSync(file, 'utf8')
			expect(content).toContain('create schema if not exists')
			expect(content).toContain('create extension if not exists')
		} finally {
			if (existsSync(file)) unlinkSync(file)
		}
	})

	// --- DBML ---

	it('dbml() generates DBML files for each dbdocs config entry', () => {
		const dx = using('design.yaml')

		const baseFile = 'Example-base-design.dbml'
		const coreFile = 'Example-core-design.dbml'

		try {
			dx.dbml()
			expect(existsSync(baseFile)).toBe(true)
			expect(existsSync(coreFile)).toBe(true)
		} finally {
			if (existsSync(baseFile)) unlinkSync(baseFile)
			if (existsSync(coreFile)) unlinkSync(coreFile)
		}
	})

	it('dbml() returns this (chainable)', () => {
		const dx = using('design.yaml')

		const baseFile = 'Example-base-design.dbml'
		const coreFile = 'Example-core-design.dbml'

		try {
			const result = dx.dbml()
			expect(result).toBe(dx)
		} finally {
			if (existsSync(baseFile)) unlinkSync(baseFile)
			if (existsSync(coreFile)) unlinkSync(coreFile)
		}
	})

	// --- apply dry-run ---

	it('apply dry-run logs entity details without database', () => {
		const dx = using('design.yaml')
		dx.apply(undefined, true)
		expect(console.info).toHaveBeenCalled()
	})

	it('apply dry-run logs errors for invalid entities', () => {
		const dx = using('design.yaml')
		// Force an error on an entity
		dx.entities[dx.entities.length - 1].errors = ['test error']
		dx.apply(undefined, true)
		expect(console.error).toHaveBeenCalled()
	})

	// --- importData dry-run ---

	it('importData dry-run does not require database', () => {
		const dx = using('design.yaml')
		dx.importData(undefined, true)
		expect(console.info).toHaveBeenCalled()
	})

	it('importData dry-run filters by name', () => {
		const dx = using('design.yaml')
		dx.importData('staging.lookups', true)
		const calls = console.info.mock.calls.flat()
		expect(calls.some((c) => typeof c === 'string' && c.includes('staging.lookups'))).toBe(true)
	})

	// --- updateEntities ---

	it('updateEntities rebuilds entity list', () => {
		const dx = using('design.yaml')
		const originalCount = dx.entities.length
		dx.updateEntities(dx.config.entities)
		expect(dx.entities.length).toBe(originalCount)
	})

	// --- report ---

	it('report() returns warnings separately from issues', () => {
		const dx = using('design.yaml')
		const result = dx.report()
		expect(result).toHaveProperty('warnings')
		expect(Array.isArray(result.warnings)).toBe(true)
	})

	// --- roles getter ---

	it('roles getter returns array', () => {
		const dx = using('design.yaml')
		expect(Array.isArray(dx.roles)).toBe(true)
	})

	// --- importTables ---

	it('importTables are ordered by entity index', () => {
		const dx = using('design.yaml')
		const orders = dx.importTables.map((t) => t.order)
		const sorted = [...orders].sort((a, b) => a - b)
		expect(orders).toEqual(sorted)
	})

	// --- validate on importTables ---

	it('validate flags import tables with non-staging schema', () => {
		const dx = using('design.yaml')
		dx.validate()
		// All import tables in example use staging schema, so no errors from schema check
		const stagingTables = dx.importTables.filter((t) => t.schema === 'staging')
		expect(stagingTables.length).toBe(dx.importTables.length)
	})

	// --- dbml error handling ---

	it('dbml() handles generateDBML errors gracefully', () => {
		const dx = using('design.yaml')
		// Force entities to be empty to trigger edge cases
		dx.updateEntities([])

		const baseFile = 'Example-base-design.dbml'
		const coreFile = 'Example-core-design.dbml'

		try {
			dx.dbml()
			// Should not throw — errors are logged
		} finally {
			if (existsSync(baseFile)) unlinkSync(baseFile)
			if (existsSync(coreFile)) unlinkSync(coreFile)
		}
	})
})
