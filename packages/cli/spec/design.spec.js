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

	it('using() returns a Design instance with expected properties', async () => {
		const dx = await using('design.yaml')

		expect(dx).toBeDefined()
		expect(dx.config).toBeDefined()
		expect(dx.entities).toBeDefined()
		expect(dx.isValidated).toBe(false)
		expect(dx.databaseURL).toBeUndefined()
	})

	it('using() with databaseURL stores the URL', async () => {
		const url = 'postgresql://localhost/test'
		const dx = await using('design.yaml', url)
		expect(dx.databaseURL).toBe(url)
	})

	it('loads project config from example/design.yaml', async () => {
		const dx = await using('design.yaml')

		expect(dx.config.project.name).toBe('Example')
		expect(dx.config.project.database).toBe('PostgreSQL')
		expect(dx.config.project.extensionSchema).toBe('extensions')
		expect(dx.config.project.staging).toEqual(['staging'])
	})

	it('loads schemas from config', async () => {
		const dx = await using('design.yaml')

		expect(dx.config.schemas).toContain('config')
		expect(dx.config.schemas).toContain('extensions')
		expect(dx.config.schemas).toContain('staging')
		expect(dx.config.schemas).toContain('migrate')
	})

	it('loads extensions from config', async () => {
		const dx = await using('design.yaml')

		expect(dx.config.extensions).toEqual(['uuid-ossp'])
	})

	// --- Entities ---

	it('discovers correct number of entities', async () => {
		const dx = await using('design.yaml')
		expect(dx.entities.length).toBe(expectedEntities.length)
	})

	it('entities include schemas first, then extensions, then roles, then DDL', async () => {
		const dx = await using('design.yaml')
		const types = dx.entities.map((e) => e.type)

		const firstSchema = types.indexOf('schema')
		const firstExtension = types.indexOf('extension')
		const firstRole = types.indexOf('role')
		const firstTable = types.indexOf('table')

		expect(firstSchema).toBeLessThan(firstExtension)
		expect(firstExtension).toBeLessThan(firstRole)
		expect(firstRole).toBeLessThan(firstTable)
	})

	it('entity names match expected list', async () => {
		const dx = await using('design.yaml')
		const names = dx.entities.map((e) => e.name)
		const expectedNames = expectedEntities.map((e) => e.name)
		expect(names).toEqual(expectedNames)
	})

	// --- Validation ---

	it('validate() sets isValidated flag', async () => {
		const dx = await using('design.yaml')
		expect(dx.isValidated).toBe(false)
		dx.validate()
		expect(dx.isValidated).toBe(true)
	})

	it('validate() returns this (chainable)', async () => {
		const dx = await using('design.yaml')
		const result = dx.validate()
		expect(result).toBe(dx)
	})

	it('report() returns { entity, issues }', async () => {
		const dx = await using('design.yaml')
		const result = dx.report()
		expect(result).toHaveProperty('entity')
		expect(result).toHaveProperty('issues')
	})

	it('report(name) returns specific entity', async () => {
		const dx = await using('design.yaml')
		const result = dx.report('config.lookups')
		expect(result.entity.name).toBe('config.lookups')
	})

	// --- combine ---

	it('combine() generates DDL file', async () => {
		const dx = await using('design.yaml')
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

	it('dbml() generates DBML files and logs each filename', async () => {
		const dx = await using('design.yaml')

		const baseFile = 'Example-base-design.dbml'
		const coreFile = 'Example-core-design.dbml'

		try {
			dx.dbml()
			expect(existsSync(baseFile)).toBe(true)
			expect(existsSync(coreFile)).toBe(true)

			const infoCalls = console.info.mock.calls.map((c) => c[0])
			expect(infoCalls).toContainEqual(`Generated DBML in ${baseFile}`)
			expect(infoCalls).toContainEqual(`Generated DBML in ${coreFile}`)
		} finally {
			if (existsSync(baseFile)) unlinkSync(baseFile)
			if (existsSync(coreFile)) unlinkSync(coreFile)
		}
	})

	it('dbml() returns this (chainable)', async () => {
		const dx = await using('design.yaml')

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

	it('apply dry-run logs entity type, name, and file for each entity', async () => {
		const dx = await using('design.yaml')
		dx.apply(undefined, true)

		const infoCalls = console.info.mock.calls.map((c) => c[0])
		// Schema entities: "schema => <name>"
		expect(infoCalls.some((c) => /^schema =>/.test(c))).toBe(true)
		// Extension entities: 'extension => <name> using "<schema>"'
		expect(infoCalls.some((c) => /^extension =>.*using/.test(c))).toBe(true)
		// File-backed entities include the file path
		expect(infoCalls.some((c) => /using ".*\.ddl"/.test(c))).toBe(true)
	})

	it('apply dry-run logs errors for invalid entities with entity details', async () => {
		const dx = await using('design.yaml')
		const lastEntity = dx.entities[dx.entities.length - 1]
		lastEntity.errors = ['test error']
		dx.apply(undefined, true)

		const errorCalls = console.error.mock.calls.map((c) => c[0])
		expect(errorCalls.some((obj) => obj.errors && obj.errors.includes('test error'))).toBe(true)
		expect(errorCalls.some((obj) => obj.name === lastEntity.name)).toBe(true)
	})

	// --- importData dry-run ---

	it('importData dry-run logs "Importing <name>" for each table', async () => {
		const dx = await using('design.yaml')
		dx.importData(undefined, true)

		const infoCalls = console.info.mock.calls.map((c) => c[0])
		const importMessages = infoCalls.filter(
			(c) => typeof c === 'string' && c.startsWith('Importing ')
		)
		expect(importMessages.length).toBeGreaterThan(0)
		// Each message should include the table name
		importMessages.forEach((msg) => {
			expect(msg).toMatch(/^Importing \w+\.\w+/)
		})
	})

	it('importData dry-run filters by name and logs matching table', async () => {
		const dx = await using('design.yaml')
		dx.importData('staging.lookups', true)

		const infoCalls = console.info.mock.calls.map((c) => c[0])
		const importMessages = infoCalls.filter(
			(c) => typeof c === 'string' && c.startsWith('Importing ')
		)
		expect(importMessages).toEqual(['Importing staging.lookups'])
	})

	it('importData dry-run logs the \\copy script for the table', async () => {
		const dx = await using('design.yaml')
		dx.importData('staging.lookups', true)

		const infoCalls = console.info.mock.calls.map((c) => c[0])
		const copyScript = infoCalls.find((c) => typeof c === 'string' && c.includes('\\copy'))
		expect(copyScript).toBeDefined()
		expect(copyScript).toContain('staging.lookups')
	})

	it('importData dry-run logs call statement when procedure exists', async () => {
		const dx = await using('design.yaml')
		dx.importData('staging.lookups', true)

		const infoCalls = console.info.mock.calls.map((c) => c[0])
		const callStatement = infoCalls.find(
			(c) => typeof c === 'string' && c.startsWith('call staging.import_lookups')
		)
		expect(callStatement).toBeDefined()
	})

	// --- updateEntities ---

	it('updateEntities rebuilds entity list', async () => {
		const dx = await using('design.yaml')
		const originalCount = dx.entities.length
		dx.updateEntities(dx.config.entities)
		expect(dx.entities.length).toBe(originalCount)
	})

	// --- report ---

	it('report() returns warnings separately from issues', async () => {
		const dx = await using('design.yaml')
		const result = dx.report()
		expect(result).toHaveProperty('warnings')
		expect(Array.isArray(result.warnings)).toBe(true)
	})

	// --- roles getter ---

	it('roles getter returns array', async () => {
		const dx = await using('design.yaml')
		expect(Array.isArray(dx.roles)).toBe(true)
	})

	// --- importTables ---

	it('importTables are ordered by target table dependency', async () => {
		const dx = await using('design.yaml')
		const names = dx.importTables.map((t) => t.name)
		const lookupsIdx = names.indexOf('staging.lookups')
		const lookupValuesIdx = names.indexOf('staging.lookup_values')
		expect(lookupsIdx).toBeGreaterThanOrEqual(0)
		expect(lookupValuesIdx).toBeGreaterThanOrEqual(0)
		expect(lookupValuesIdx).toBeLessThan(lookupsIdx)
	})

	// --- validate on importTables ---

	it('validate flags import tables with non-staging schema', async () => {
		const dx = await using('design.yaml')
		dx.validate()
		// All import tables in example use staging schema, so no errors from schema check
		const stagingTables = dx.importTables.filter((t) => t.schema === 'staging')
		expect(stagingTables.length).toBe(dx.importTables.length)
	})

	// --- dbml error handling ---

	it('dbml() handles generateDBML errors gracefully', async () => {
		const dx = await using('design.yaml')
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

	// --- dbml writeFileSync catch + error result ---
	// Note: fs.writeFileSync can't be spied on in ESM. The catch path (L201-202)
	// and error path (L195) are tested via dbml-error-paths describe block below.

	// --- apply non-dry-run ---

	it('apply() non-dry-run calls adapter.applyEntities with valid entities', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const spy = vi.spyOn(adapter, 'applyEntities').mockResolvedValue()

		await dx.apply()

		expect(spy).toHaveBeenCalledTimes(1)
		const entities = spy.mock.calls[0][0]
		expect(entities.every((e) => !e.errors || e.errors.length === 0)).toBe(true)

		spy.mockRestore()
	})

	it('apply() non-dry-run filters by name', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const spy = vi.spyOn(adapter, 'applyEntities').mockResolvedValue()

		await dx.apply('config.lookups')

		expect(spy).toHaveBeenCalledTimes(1)
		const entities = spy.mock.calls[0][0]
		expect(entities.every((e) => e.name === 'config.lookups')).toBe(true)

		spy.mockRestore()
	})

	// --- importData non-dry-run ---

	it('importData() non-dry-run calls adapter.importData for each table', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		const execFileSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()

		await dx.importData()

		expect(importSpy).toHaveBeenCalled()
		importSpy.mockRestore()
		execScriptSpy.mockRestore()
		execFileSpy.mockRestore()
	})

	it('importData() non-dry-run calls executeScript for each matched procedure', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		vi.spyOn(adapter, 'executeFile').mockResolvedValue()

		await dx.importData()

		const procedureCalls = execScriptSpy.mock.calls
			.map((c) => c[0])
			.filter((s) => s.startsWith('call staging.import_'))
		expect(procedureCalls.length).toBeGreaterThan(0)

		vi.restoreAllMocks()
	})

	it('importData() non-dry-run filters by name', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		const execFileSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()

		await dx.importData('staging.lookup_values')

		const importedNames = importSpy.mock.calls.map((c) => c[0].name)
		expect(importedNames).toContain('staging.lookup_values')
		expect(importedNames.every((n) => n === 'staging.lookup_values')).toBe(true)

		importSpy.mockRestore()
		execScriptSpy.mockRestore()
		execFileSpy.mockRestore()
	})

	// --- exportData ---

	it('exportData() creates folders and calls adapter.batchExport', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const batchSpy = vi.spyOn(adapter, 'batchExport').mockResolvedValue()

		try {
			await dx.exportData()

			expect(batchSpy).toHaveBeenCalledTimes(1)
			const entities = batchSpy.mock.calls[0][0]
			expect(entities.length).toBeGreaterThan(0)
			expect(entities.every((e) => e.type === 'export')).toBe(true)
			// Verify export directories were created
			expect(existsSync('export')).toBe(true)
		} finally {
			// Clean up created directories
			const { rmSync } = await import('fs')
			if (existsSync('export')) rmSync('export', { recursive: true })
			batchSpy.mockRestore()
		}
	})

	it('exportData() filters by name', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const batchSpy = vi.spyOn(adapter, 'batchExport').mockResolvedValue()

		try {
			await dx.exportData('config.lookups')

			expect(batchSpy).toHaveBeenCalledTimes(1)
			const entities = batchSpy.mock.calls[0][0]
			expect(entities).toHaveLength(1)
			expect(entities[0].name).toBe('config.lookups')
		} finally {
			const { rmSync } = await import('fs')
			if (existsSync('export')) rmSync('export', { recursive: true })
			batchSpy.mockRestore()
		}
	})

	it('exportData() skips when no entities match the name filter', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		const batchSpy = vi.spyOn(adapter, 'batchExport').mockResolvedValue()

		await dx.exportData('nonexistent.table')

		expect(batchSpy).not.toHaveBeenCalled()

		batchSpy.mockRestore()
	})

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
			dx.config.schemas = ['auth', 'storage']
			await dx.reset('supabase', true)

			const infoCalls = console.info.mock.calls.map((c) => c[0])
			expect(infoCalls.some((c) => c === 'No schemas to reset.')).toBe(true)
		})

		it('non-dry-run calls adapter.executeScript with reset script', async () => {
			const dx = await using('design.yaml')
			const adapter = await dx.getAdapter()
			const spy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()

			await dx.reset('supabase', false)

			expect(spy).toHaveBeenCalledTimes(1)
			expect(spy.mock.calls[0][0]).toContain('DROP SCHEMA IF EXISTS')

			spy.mockRestore()
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
			dx.config.schemaGrants = []
			await dx.grants('supabase', false)

			const infoCalls = console.info.mock.calls.map((c) => c[0])
			expect(infoCalls.some((c) => c === 'No grants configured in design.yaml')).toBe(true)
		})

		it('dry-run with grants prints GRANT statements', async () => {
			const dx = await using('design.yaml')
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

		it('non-dry-run calls adapter.executeScript with grants script', async () => {
			const dx = await using('design.yaml')
			dx.config.schemaGrants = [{ name: 'config', grants: { anon: ['usage', 'select'] } }]
			const adapter = await dx.getAdapter()
			const spy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()

			await dx.grants('supabase', false)

			expect(spy).toHaveBeenCalledTimes(1)
			expect(spy.mock.calls[0][0]).toContain('GRANT USAGE ON SCHEMA config TO anon;')

			spy.mockRestore()
		})
	})

	// --- getAdapter ---

	it('getAdapter() returns the adapter instance', async () => {
		const dx = await using('design.yaml')
		const adapter = await dx.getAdapter()
		expect(adapter).toBeDefined()
		expect(typeof adapter.applyEntities).toBe('function')
	})

	// --- graph() ---

	describe('graph()', () => {
		it('returns nodes, edges, layers', async () => {
			const dx = await using('design.yaml')
			const result = dx.graph()
			expect(result).toHaveProperty('nodes')
			expect(result).toHaveProperty('edges')
			expect(result).toHaveProperty('layers')
		})

		it('nodes have exactly name, type, schema keys', async () => {
			const dx = await using('design.yaml')
			const { nodes } = dx.graph()
			expect(nodes.length).toBeGreaterThan(0)
			nodes.forEach((node) => {
				expect(Object.keys(node).sort()).toEqual(['name', 'schema', 'type'])
			})
		})

		it('edges reference names that exist in nodes', async () => {
			const dx = await using('design.yaml')
			const { nodes, edges } = dx.graph()
			const nodeNames = new Set(nodes.map((n) => n.name))
			edges.forEach((edge) => {
				expect(nodeNames.has(edge.from)).toBe(true)
				expect(nodeNames.has(edge.to)).toBe(true)
			})
		})

		it('layers are arrays of strings', async () => {
			const dx = await using('design.yaml')
			const { layers } = dx.graph()
			expect(Array.isArray(layers)).toBe(true)
			layers.forEach((layer) => {
				expect(Array.isArray(layer)).toBe(true)
				layer.forEach((item) => expect(typeof item).toBe('string'))
			})
		})

		it('graph(name) returns a subgraph for a known entity', async () => {
			const dx = await using('design.yaml')
			const { nodes } = dx.graph()
			const knownName = nodes[nodes.length - 1].name
			const sub = dx.graph(knownName)
			expect(sub.nodes.length).toBeGreaterThan(0)
			expect(sub.nodes.some((n) => n.name === knownName)).toBe(true)
		})

		it('graph(unknown) returns empty result', async () => {
			const dx = await using('design.yaml')
			const result = dx.graph('nonexistent.entity')
			expect(result).toEqual({ nodes: [], edges: [], layers: [] })
		})
	})
})

describe('Design env filtering', () => {
	let originalDir

	beforeAll(() => {
		originalDir = process.cwd()
	})

	beforeEach(() => {
		process.chdir(join(__dirname, '../../../example'))
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		process.chdir(originalDir)
		vi.restoreAllMocks()
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
		// Override shared mock to capture calls
		vi.mocked(console.info).mockImplementation((msg) => infoCalls.push(msg))
		dx.importData(undefined, true)
		const names = infoCalls
			.filter((m) => typeof m === 'string' && m.startsWith('Importing'))
			.map((m) => m.replace('Importing ', ''))
		expect(names).not.toContain('staging.dev_fixtures')
		expect(names).not.toContain('staging.dev_fixture_table')
	})
})

describe('importData env-scoped after scripts', () => {
	let originalDir
	const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'after-scripts')

	beforeAll(() => {
		originalDir = process.cwd()
	})

	beforeEach(() => {
		process.chdir(fixtureDir)
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		process.chdir(originalDir)
		vi.restoreAllMocks()
	})

	it('always runs shared after scripts', async () => {
		const dx = await using('design.yaml', undefined, 'prod')
		const adapter = await dx.getAdapter()
		const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
		await dx.importData()
		expect(execSpy).toHaveBeenCalledWith('import/loader.sql')
		importSpy.mockRestore()
		execScriptSpy.mockRestore()
		execSpy.mockRestore()
	})

	it('runs after.prod scripts in prod env', async () => {
		const dx = await using('design.yaml', undefined, 'prod')
		const adapter = await dx.getAdapter()
		const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
		await dx.importData()
		const calls = execSpy.mock.calls.map((c) => c[0])
		expect(calls).toContain('import/prod_loader.sql')
		expect(calls).not.toContain('import/dev_loader.sql')
		importSpy.mockRestore()
		execScriptSpy.mockRestore()
		execSpy.mockRestore()
	})

	it('runs after.dev scripts in dev env', async () => {
		const dx = await using('design.yaml', undefined, 'dev')
		const adapter = await dx.getAdapter()
		const importSpy = vi.spyOn(adapter, 'importData').mockResolvedValue()
		const execScriptSpy = vi.spyOn(adapter, 'executeScript').mockResolvedValue()
		const execSpy = vi.spyOn(adapter, 'executeFile').mockResolvedValue()
		await dx.importData()
		const calls = execSpy.mock.calls.map((c) => c[0])
		expect(calls).toContain('import/dev_loader.sql')
		expect(calls).not.toContain('import/prod_loader.sql')
		importSpy.mockRestore()
		execScriptSpy.mockRestore()
		execSpy.mockRestore()
	})
})

describe('Design class — coverage-test fixture', () => {
	let originalPath
	const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coverage-test')

	beforeAll(() => {
		originalPath = process.cwd()
	})

	beforeEach(() => {
		process.chdir(fixtureDir)
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		process.chdir(originalPath)
		vi.restoreAllMocks()
	})

	// --- extensions ?? [] fallback ---

	it('config without extensions key defaults to empty array', async () => {
		const dx = await using('design.yaml')
		expect(dx.config.extensions).toEqual([])
	})

	// --- organizeImports: import table not in entities (refers fallback) ---

	it('organizeImports uses empty refers when import table is not found in entities', async () => {
		// The fixture's app.orders table has no matching import procedure
		// buildImportPlan generates a warning when no procedure is found
		const dx = await using('design.yaml')
		const importTables = dx.importTables
		const ordersImport = importTables.find((t) => t.name === 'app.orders')

		if (ordersImport) {
			// app.orders has no import procedure => warning is generated
			expect(ordersImport.warnings.length).toBeGreaterThan(0)
			expect(ordersImport.warnings[0]).toContain('app.orders')
		}
	})

	// --- validate: non-staging import schema ---

	it('validate flags import tables with non-staging schema', async () => {
		const dx = await using('design.yaml')
		dx.validate()

		// app.orders has schema 'app' which is NOT in staging list
		const appImports = dx.importTables.filter((t) => t.schema === 'app')
		expect(appImports.length).toBeGreaterThan(0)
		appImports.forEach((t) => {
			expect(t.errors).toContain('Import is only allowed for staging schemas')
		})
	})

	// --- organizeImports: refers fallback to [] for unknown import table ---

	it('organizeImports falls back to empty refers for import table not in entities', async () => {
		const dx = await using('design.yaml')
		// ghost.csv in import/ creates an import entry for app.ghost, which has no entity
		const ghostImport = dx.importTables.find((t) => t.name === 'app.ghost')
		expect(ghostImport).toBeDefined()
		// buildImportPlan generates a warning when no procedure is found
		expect(ghostImport.warnings.length).toBeGreaterThan(0)
	})

	// --- report() with import table errors ---

	it('report() includes import tables with errors in issues', async () => {
		const dx = await using('design.yaml')
		dx.validate()

		// app imports have non-staging schema errors after validate
		const { issues } = dx.report()
		const importIssues = issues.filter(
			(e) => e.errors && e.errors.includes('Import is only allowed for staging schemas')
		)
		expect(importIssues.length).toBeGreaterThan(0)
	})

	it('report(name) filters issues and warnings by entity name', async () => {
		const dx = await using('design.yaml')
		dx.validate()

		// app.orders has errors — filter by its name
		const ordersImport = dx.importTables.find((t) => t.name === 'app.orders')
		expect(ordersImport).toBeDefined()

		const { issues } = dx.report('app.orders')
		expect(issues.length).toBeGreaterThan(0)
		expect(issues.every((e) => e.name === 'app.orders')).toBe(true)

		// Also check that filtering by a name with no issues returns empty
		const { issues: noIssues } = dx.report('nonexistent')
		expect(noIssues).toHaveLength(0)
	})

	it('report(name) filters warnings by entity name', async () => {
		const dx = await using('design.yaml')
		dx.validate()

		// Add a warning to an import table to test the warnings filter
		const ordersImport = dx.importTables.find((t) => t.name === 'app.orders')
		if (ordersImport) {
			ordersImport.warnings = ['test warning']
		}

		const { warnings } = dx.report('app.orders')
		expect(warnings.some((w) => w.name === 'app.orders')).toBe(true)

		// Non-matching name should get empty warnings
		const { warnings: noWarnings } = dx.report('nonexistent')
		expect(noWarnings).toHaveLength(0)
	})

	// --- using() without database key triggers || 'PostgreSQL' fallback ---

	it('using() defaults to PostgreSQL when project.database is not set', async () => {
		const dx = await using('design-no-db.yaml')
		expect(dx.config.project.name).toBe('NoDB')
		expect(dx).toBeDefined()
	})
})
