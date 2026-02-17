/**
 * Compatibility test suite for the Design class (src/collect.js).
 *
 * These tests lock in user-facing behavior of the Design class when used
 * with the example/ project. They do NOT require PostgreSQL — only the
 * pure / filesystem parts are exercised.
 *
 * Every subsequent migration batch must keep these tests green.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { resetCache } from '../../src/exclusions.js'
import { using } from '../../src/collect.js'
import { entities as expectedEntities } from '../fixtures/design/config.js'

describe('Design class compatibility', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	beforeEach(() => {
		resetCache()
		process.chdir('example')
	})

	afterEach(() => {
		process.chdir(originalPath)
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

		// config, extensions, staging, migrate are declared; staging is added from DDL scan
		expect(dx.config.schemas).toContain('config')
		expect(dx.config.schemas).toContain('extensions')
		expect(dx.config.schemas).toContain('staging')
		expect(dx.config.schemas).toContain('migrate')
	})

	it('loads extensions from config', () => {
		const dx = using('design.yaml')

		expect(dx.config.extensions).toEqual(['uuid-ossp'])
	})

	it('loads import config', () => {
		const dx = using('design.yaml')

		expect(dx.config.import).toEqual({
			options: { truncate: true, nullValue: '' },
			tables: ['staging.lookup_values'],
			after: ['import/loader.sql']
		})
	})

	it('loads export config', () => {
		const dx = using('design.yaml')

		expect(dx.config.export).toEqual([
			'config.lookups',
			'config.lookup_values',
			'config.genders',
			'migrate.lookup_values'
		])
	})

	it('loads dbdocs config', () => {
		const dx = using('design.yaml')

		expect(dx.config.project.dbdocs).toEqual({
			base: { exclude: { schemas: ['staging', 'migrate', 'extensions'] } },
			core: { include: { schemas: ['config'] } }
		})
	})

	// --- Entity discovery ---

	it('discovers all entities from example/ (schemas + extensions + roles + DDL entities)', () => {
		const dx = using('design.yaml')

		// 4 schemas + 1 extension + 2 roles + DDL entities
		expect(dx.entities.length).toBe(expectedEntities.length)
	})

	it('entities start with schemas, then extensions, then roles', () => {
		const dx = using('design.yaml')

		const schemas = dx.entities.filter((e) => e.type === 'schema')
		const extensions = dx.entities.filter((e) => e.type === 'extension')
		const roles = dx.entities.filter((e) => e.type === 'role')

		expect(schemas).toHaveLength(4)
		expect(extensions).toHaveLength(1)
		expect(roles).toHaveLength(2)

		// Schemas come first
		const firstSchemaIdx = dx.entities.findIndex((e) => e.type === 'schema')
		const firstExtIdx = dx.entities.findIndex((e) => e.type === 'extension')
		const firstRoleIdx = dx.entities.findIndex((e) => e.type === 'role')

		expect(firstSchemaIdx).toBeLessThan(firstExtIdx)
		expect(firstExtIdx).toBeLessThan(firstRoleIdx)
	})

	it('schema entities have the correct shape', () => {
		const dx = using('design.yaml')
		const schemas = dx.entities.filter((e) => e.type === 'schema')

		schemas.forEach((s) => {
			expect(s).toEqual({ type: 'schema', name: expect.any(String) })
		})
		expect(schemas.map((s) => s.name)).toEqual(['config', 'extensions', 'staging', 'migrate'])
	})

	it('extension entity has correct shape', () => {
		const dx = using('design.yaml')
		const ext = dx.entities.find((e) => e.type === 'extension')

		expect(ext).toEqual({
			type: 'extension',
			name: 'uuid-ossp',
			schema: 'extensions'
		})
	})

	it('role entities are in dependency order (basic before advanced)', () => {
		const dx = using('design.yaml')
		const roles = dx.entities.filter((e) => e.type === 'role')

		const basicIdx = roles.findIndex((r) => r.name === 'basic')
		const advancedIdx = roles.findIndex((r) => r.name === 'advanced')

		expect(basicIdx).toBeLessThan(advancedIdx)
		expect(roles[basicIdx].refers).toEqual([])
		expect(roles[advancedIdx].refers).toEqual(['basic'])
	})

	it('DDL entities have file, schema, format, refers, references, searchPaths, errors', () => {
		const dx = using('design.yaml')
		const ddlEntities = dx.entities.filter((e) => !['schema', 'extension', 'role'].includes(e.type))

		ddlEntities.forEach((entity) => {
			expect(entity).toHaveProperty('file')
			expect(entity).toHaveProperty('schema')
			expect(entity).toHaveProperty('format', 'ddl')
			expect(entity).toHaveProperty('refers')
			expect(entity).toHaveProperty('references')
			expect(entity).toHaveProperty('searchPaths')
			expect(entity).toHaveProperty('errors')
			expect(Array.isArray(entity.refers)).toBe(true)
			expect(Array.isArray(entity.references)).toBe(true)
			expect(Array.isArray(entity.searchPaths)).toBe(true)
			expect(Array.isArray(entity.errors)).toBe(true)
		})
	})

	it('entities are in dependency order (tables before views/procedures that depend on them)', () => {
		const dx = using('design.yaml')
		const ddlEntities = dx.entities.filter((e) => !['schema', 'extension', 'role'].includes(e.type))

		// For each entity with refers, all referred entities should appear earlier
		const nameIndex = {}
		dx.entities.forEach((e, i) => {
			nameIndex[e.name] = i
		})

		ddlEntities.forEach((entity) => {
			const myIdx = nameIndex[entity.name]
			entity.refers.forEach((ref) => {
				if (ref in nameIndex) {
					expect(nameIndex[ref]).toBeLessThan(myIdx)
				}
			})
		})
	})

	it('all expected entity names are present', () => {
		const dx = using('design.yaml')
		const names = dx.entities.map((e) => e.name)

		const expected = [
			'config',
			'extensions',
			'staging',
			'migrate',
			'uuid-ossp',
			'basic',
			'advanced',
			'config.lookups',
			'staging.import_jsonb_to_table',
			'staging.lookup_values',
			'staging.lookups',
			'config.lookup_values',
			'staging.import_lookups',
			'config.genders',
			'config.range_values',
			'migrate.lookup_values',
			'staging.import_lookup_values'
		]

		expected.forEach((name) => {
			expect(names).toContain(name)
		})
	})

	it('entity list matches expected fixture data', () => {
		const dx = using('design.yaml')

		// Compare entity by entity against fixture
		for (let i = 0; i < expectedEntities.length; i++) {
			expect(dx.entities[i]).toEqual(expectedEntities[i])
		}
	})

	// --- Import tables ---

	it('importTables are organized with order and refers', () => {
		const dx = using('design.yaml')

		expect(dx.importTables).toBeDefined()
		expect(Array.isArray(dx.importTables)).toBe(true)

		dx.importTables.forEach((table) => {
			expect(table).toHaveProperty('order')
			expect(table).toHaveProperty('refers')
			expect(table).toHaveProperty('warnings')
			expect(table).toHaveProperty('name')
		})
	})

	it('importTables include staging.lookup_values from config', () => {
		const dx = using('design.yaml')

		const names = dx.importTables.map((t) => t.name)
		expect(names).toContain('staging.lookup_values')
	})

	it('importTables include file-discovered imports', () => {
		const dx = using('design.yaml')

		// import/ folder has staging/lookup_values.csv and staging/lookups.csv
		const names = dx.importTables.map((t) => t.name)
		expect(names).toContain('staging.lookups')
	})

	// --- Validation ---

	it('validate() sets isValidated to true', () => {
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

	it('report() auto-validates if not yet validated', () => {
		const dx = using('design.yaml')

		expect(dx.isValidated).toBe(false)
		dx.report()
		expect(dx.isValidated).toBe(true)
	})

	it('example project has zero issues', () => {
		const dx = using('design.yaml')
		const result = dx.report()

		expect(result).toEqual({ entity: undefined, issues: [] })
	})

	it('report(name) filters to specific entity', () => {
		const dx = using('design.yaml')
		const result = dx.report('config.lookups')

		expect(result.entity).toBeDefined()
		expect(result.entity.name).toBe('config.lookups')
		expect(result.issues).toEqual([])
	})

	it('report(name) for non-existent entity returns undefined entity', () => {
		const dx = using('design.yaml')
		const result = dx.report('does.not.exist')

		expect(result.entity).toBeUndefined()
		expect(result.issues).toEqual([])
	})

	// --- Combine ---

	it('combine() generates a combined DDL file', () => {
		const dx = using('design.yaml')
		const file = '_compat_combined.ddl'

		try {
			dx.combine(file)
			expect(existsSync(file)).toBe(true)

			const content = readFileSync(file, 'utf8')
			// Should contain schema creation
			expect(content).toContain('create schema if not exists config')
			expect(content).toContain('create schema if not exists extensions')
			expect(content).toContain('create schema if not exists staging')
			expect(content).toContain('create schema if not exists migrate')
			// Should contain extension
			expect(content).toContain('uuid-ossp')
			// Should contain role creation
			expect(content).toContain('CREATE ROLE basic')
			expect(content).toContain('CREATE ROLE advanced')
			// Should contain table DDL
			expect(content).toContain('config.lookups')
			expect(content).toContain('config.lookup_values')
		} finally {
			if (existsSync(file)) unlinkSync(file)
		}
	})

	it('combine() returns this (chainable)', () => {
		const dx = using('design.yaml')
		const file = '_compat_combined2.ddl'

		try {
			const result = dx.combine(file)
			expect(result).toBe(dx)
		} finally {
			if (existsSync(file)) unlinkSync(file)
		}
	})

	it('combine() output is in dependency order', () => {
		const dx = using('design.yaml')
		const file = '_compat_order.ddl'

		try {
			dx.combine(file)
			const content = readFileSync(file, 'utf8')

			// Schemas before extensions before roles before tables
			const schemaPos = content.indexOf('create schema if not exists config')
			const extPos = content.indexOf('uuid-ossp')
			const rolePos = content.indexOf('CREATE ROLE basic')
			const tablePos = content.indexOf('config.lookups')

			expect(schemaPos).toBeLessThan(extPos)
			expect(extPos).toBeLessThan(rolePos)
			expect(rolePos).toBeLessThan(tablePos)
		} finally {
			if (existsSync(file)) unlinkSync(file)
		}
	})

	// --- DBML ---

	it('dbml() generates DBML files for each dbdocs config entry', () => {
		const dx = using('design.yaml')
		const files = ['Example-base-design.dbml', 'Example-core-design.dbml']

		try {
			dx.dbml()

			files.forEach((file) => {
				expect(existsSync(file)).toBe(true)
			})
		} finally {
			files.forEach((file) => {
				if (existsSync(file)) unlinkSync(file)
			})
			if (existsSync('combined.sql')) unlinkSync('combined.sql')
		}
	})

	it('dbml() output contains valid DBML with Project block', () => {
		const dx = using('design.yaml')
		const files = ['Example-base-design.dbml', 'Example-core-design.dbml']

		try {
			dx.dbml()

			files.forEach((file) => {
				const content = readFileSync(file, 'utf8')
				expect(content).toContain('Project "Example-')
				expect(content).toContain("database_type: 'PostgreSQL'")
			})
		} finally {
			files.forEach((file) => {
				if (existsSync(file)) unlinkSync(file)
			})
			if (existsSync('combined.sql')) unlinkSync('combined.sql')
		}
	})

	it('dbml() base config excludes staging/migrate/extensions schemas', () => {
		const dx = using('design.yaml')
		const files = ['Example-base-design.dbml', 'Example-core-design.dbml']

		try {
			dx.dbml()

			const baseContent = readFileSync('Example-base-design.dbml', 'utf8')
			// Should include config tables but not staging/migrate/extensions
			expect(baseContent).toContain('config')
			expect(baseContent).not.toMatch(/Table\s+"staging"/)
		} finally {
			files.forEach((file) => {
				if (existsSync(file)) unlinkSync(file)
			})
			if (existsSync('combined.sql')) unlinkSync('combined.sql')
		}
	})

	it('dbml() core config includes only config schema', () => {
		const dx = using('design.yaml')
		const files = ['Example-base-design.dbml', 'Example-core-design.dbml']

		try {
			dx.dbml()

			const coreContent = readFileSync('Example-core-design.dbml', 'utf8')
			expect(coreContent).toContain('config')
		} finally {
			files.forEach((file) => {
				if (existsSync(file)) unlinkSync(file)
			})
			if (existsSync('combined.sql')) unlinkSync('combined.sql')
		}
	})

	it('dbml() returns this (chainable)', () => {
		const dx = using('design.yaml')
		const files = ['Example-base-design.dbml', 'Example-core-design.dbml']

		try {
			const result = dx.dbml()
			expect(result).toBe(dx)
		} finally {
			files.forEach((file) => {
				if (existsSync(file)) unlinkSync(file)
			})
			if (existsSync('combined.sql')) unlinkSync('combined.sql')
		}
	})

	// --- Dry-run mode ---

	it('importData dry-run does not require database', () => {
		const dx = using('design.yaml')
		// dry-run should not throw even without a database URL
		expect(() => dx.importData(null, true)).not.toThrow()
	})

	// --- Bad example validation ---

	it('validates bad-example project and finds errors', () => {
		process.chdir('../spec/fixtures/bad-example')

		const dx = using('design-bad.yaml').validate()

		const issues = dx.report().issues
		expect(issues.length).toBeGreaterThan(0)

		// Should find entities with errors
		const errorNames = issues.map((i) => i.name)
		expect(errorNames).toContain('core.lookups')
	})

	it('bad-example import tables have staging schema restriction errors', () => {
		process.chdir('../spec/fixtures/bad-example')

		const dx = using('design-bad.yaml').validate()

		const nonStagingImports = dx.importTables.filter((t) =>
			t.errors?.includes('Import is only allowed for staging schemas')
		)
		expect(nonStagingImports.length).toBeGreaterThan(0)
	})
})
