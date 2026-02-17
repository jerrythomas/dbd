/**
 * Compatibility test suite for configuration loading (src/metadata.js, src/filler.js).
 *
 * Snapshots the config reading, entity scanning, merging, dependency resolution,
 * and cycle detection behaviors with known inputs.
 *
 * Every subsequent migration batch must keep these tests green.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { resetCache } from '../../src/exclusions.js'
import { scan, read, clean, merge, organize, regroup } from '../../src/metadata.js'
import { fillMissingInfoForEntities } from '../../src/filler.js'
import { fixtures } from '../fixtures/metadata/index.js'

describe('Configuration loading compatibility', () => {
	let originalPath
	const { metadata: metadataFixtures, mdfix, clean: cleanFixtures } = fixtures

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

	// --- scan() ---

	describe('scan()', () => {
		it('discovers all DDL files from example/ddl/', () => {
			const files = scan('ddl').sort()

			expect(files).toEqual([
				'ddl/procedure/staging/import_jsonb_to_table.ddl',
				'ddl/procedure/staging/import_lookup_values.ddl',
				'ddl/procedure/staging/import_lookups.ddl',
				'ddl/table/config/lookup_values.ddl',
				'ddl/table/config/lookups.ddl',
				'ddl/table/staging/lookup_values.ddl',
				'ddl/table/staging/lookups.ddl',
				'ddl/view/config/genders.ddl',
				'ddl/view/config/range_values.ddl',
				'ddl/view/migrate/lookup_values.ddl'
			])
		})

		it('discovers import files from example/import/', () => {
			const files = scan('import').sort()

			expect(files).toContain('import/staging/lookup_values.csv')
			expect(files).toContain('import/staging/lookups.csv')
			expect(files).toContain('import/loader.sql')
		})

		it('returns flat array of relative paths', () => {
			const files = scan('ddl')
			files.forEach((f) => {
				expect(f).toMatch(/^ddl\//)
				expect(f).not.toMatch(/^\//) // not absolute
			})
		})
	})

	// --- read() ---

	describe('read()', () => {
		it('parses example/design.yaml correctly', () => {
			const config = read('design.yaml')

			expect(config.schemas).toEqual(['config', 'extensions', 'staging', 'migrate'])
			expect(config.project.name).toBe('Example')
			expect(config.project.database).toBe('PostgreSQL')
			expect(config.project.staging).toEqual(['staging'])
		})

		it('fills missing entity types with empty arrays', () => {
			const config = read('design.yaml')

			expect(config.tables).toEqual([])
			expect(config.views).toEqual([])
			expect(config.functions).toEqual([])
			expect(config.procedures).toEqual([])
		})

		it('reads roles with type and default refers', () => {
			const config = read('design.yaml')

			expect(config.roles).toEqual([
				{ refers: ['basic'], name: 'advanced', type: 'role' },
				{ refers: [], name: 'basic', type: 'role' }
			])
		})

		it('builds entities array from all type arrays', () => {
			const config = read('design.yaml')

			// entities = tables + views + functions + procedures (all empty in example)
			expect(config.entities).toEqual([])
		})

		it('reads import config', () => {
			const config = read('design.yaml')

			expect(config.import).toEqual({
				options: { truncate: true, nullValue: '' },
				tables: ['staging.lookup_values'],
				after: ['import/loader.sql']
			})
		})

		it('reads export config', () => {
			const config = read('design.yaml')

			expect(config.export).toEqual([
				'config.lookups',
				'config.lookup_values',
				'config.genders',
				'migrate.lookup_values'
			])
		})

		it('reads minimal config without errors', () => {
			process.chdir(originalPath)
			const config = read('spec/fixtures/bad-example/design-missing.yaml')

			expect(config).toEqual({
				schemas: [],
				roles: [],
				tables: [],
				views: [],
				functions: [],
				procedures: [],
				entities: [],
				project: {
					name: 'Example',
					staging: []
				}
			})
		})
	})

	// --- fillMissingInfoForEntities() ---

	describe('fillMissingInfoForEntities()', () => {
		it('returns empty arrays for all types on empty input', () => {
			expect(fillMissingInfoForEntities({})).toEqual({
				roles: [],
				tables: [],
				views: [],
				functions: [],
				procedures: []
			})
		})

		it('forces type field and adds default refers', () => {
			const input = {
				tables: [{ name: 'alpha' }, { name: 'beta', refers: ['alpha'], type: 'invalid' }]
			}
			const result = fillMissingInfoForEntities(input)

			expect(result.tables[0]).toEqual({
				refers: [],
				name: 'alpha',
				type: 'table'
			})
			// type is forced to 'table' even if input had 'invalid'
			expect(result.tables[1].type).toBe('table')
		})
	})

	// --- clean() ---

	describe('clean()', () => {
		it('discovers DDL files and merges with config entities', () => {
			const config = read('design.yaml')
			const data = clean(config)

			// Should have discovered entities from ddl/ folder
			expect(data.entities.length).toBeGreaterThan(0)
		})

		it('adds schemas discovered from entities', () => {
			const config = read('design.yaml')
			const data = clean(config)

			expect(data.schemas).toContain('config')
			expect(data.schemas).toContain('staging')
			expect(data.schemas).toContain('migrate')
		})

		it('separates roles from entities', () => {
			const config = read('design.yaml')
			const data = clean(config)

			// roles should not be in entities
			const entityTypes = data.entities.map((e) => e.type)
			expect(entityTypes).not.toContain('role')

			// roles should be in data.roles
			expect(data.roles.length).toBeGreaterThanOrEqual(2)
		})

		it('discovers import tables from import/ folder', () => {
			const config = read('design.yaml')
			const data = clean(config)

			expect(data.importTables).toBeDefined()
			expect(data.importTables.length).toBeGreaterThan(0)

			const names = data.importTables.map((t) => t.name)
			expect(names).toContain('staging.lookup_values')
		})

		it('entities have references resolved', () => {
			const config = read('design.yaml')
			const data = clean(config)

			// DDL entities should have references, refers, searchPaths populated
			const ddlEntities = data.entities.filter((e) => e.file)
			ddlEntities.forEach((entity) => {
				expect(entity).toHaveProperty('references')
				expect(entity).toHaveProperty('refers')
				expect(entity).toHaveProperty('searchPaths')
			})
		})

		it('matches fixture clean output for entities', () => {
			process.chdir(originalPath)
			process.chdir('example')

			const data = clean(cleanFixtures.input)
			data.entities.sort((a, b) => a.name.localeCompare(b.name))
			const expected = [...cleanFixtures.output.entities].filter(Boolean)
			expected.sort((a, b) => a.name.localeCompare(b.name))

			for (let i = 0; i < data.entities.length; i++) {
				expect(data.entities[i]).toEqual(expected[i])
			}
		})
	})

	// --- merge() ---

	describe('merge()', () => {
		it('merges two entity arrays by name (y overrides x)', () => {
			const x = [
				{ type: 'table', name: 'config.lookups', file: 'ddl/table/config/lookups.ddl' },
				{ type: 'table', name: 'config.lookup_values', file: 'ddl/table/config/lookup_values.ddl' },
				{ type: 'view', name: 'config.genders', file: 'ddl/table/config/genders.ddl' },
				{
					type: 'table',
					name: 'staging.lookup_values',
					file: 'ddl/table/staging/lookup_values.ddl'
				}
			]
			const y = [
				{ type: 'table', name: 'config.lookup_values', refers: ['config.lookups'] },
				{
					type: 'view',
					name: 'config.genders',
					refers: ['config.lookups', 'config.lookup_values']
				}
			]
			const result = merge(x, y)

			// y items come first in order, then x-only items
			expect(result[0].name).toBe('config.lookup_values')
			expect(result[0].file).toBe('ddl/table/config/lookup_values.ddl') // from x
			expect(result[0].refers).toEqual(['config.lookups']) // from y

			expect(result[1].name).toBe('config.genders')
			expect(result[1].file).toBe('ddl/table/config/genders.ddl') // from x
			expect(result[1].refers).toEqual(['config.lookups', 'config.lookup_values']) // from y

			// x-only items appended
			expect(result[2].name).toBe('config.lookups')
			expect(result[3].name).toBe('staging.lookup_values')
		})

		it('preserves x items not in y', () => {
			const x = [{ name: 'only_in_x', value: 1 }]
			const y = [{ name: 'only_in_y', value: 2 }]
			const result = merge(x, y)

			expect(result).toHaveLength(2)
			expect(result.find((r) => r.name === 'only_in_x')).toBeDefined()
			expect(result.find((r) => r.name === 'only_in_y')).toBeDefined()
		})
	})

	// --- organize() ---

	describe('organize()', () => {
		it('sorts entities by dependencies', () => {
			const result = organize(mdfix.reorder.input)
			expect(result).toEqual(mdfix.reorder.output)
		})

		it('adds missing referenced entities', () => {
			const result = organize(mdfix.missing.input)
			expect(result).toEqual(mdfix.missing.output)
		})

		it('detects cyclic dependencies', () => {
			const result = organize(mdfix.cycle.input)

			expect(result).toEqual([
				{ type: 'table', name: 'delta', refers: [], errors: [] },
				{
					type: 'table',
					name: 'alpha',
					refers: ['beta'],
					errors: ['Cyclic dependency found']
				},
				{
					type: 'table',
					name: 'beta',
					refers: ['charlie'],
					errors: ['Cyclic dependency found']
				},
				{
					type: 'table',
					name: 'charlie',
					refers: ['alpha'],
					errors: ['Cyclic dependency found']
				}
			])
		})

		it('non-cyclic entities get empty errors array', () => {
			const result = organize(mdfix.reorder.input)
			result.forEach((entity) => {
				expect(entity.errors).toEqual([])
			})
		})
	})

	// --- regroup() ---

	describe('regroup()', () => {
		it('groups simple dependencies correctly', () => {
			const result = regroup(mdfix.simple.input)
			expect(result).toEqual(mdfix.simple.output)
		})

		it('groups complex multi-level dependencies', () => {
			const result = regroup(mdfix.complex.input)
			expect(result).toEqual(mdfix.complex.output)
		})

		it('identifies cycle errors in groups', () => {
			const cycleInput = {
				alpha: { name: 'alpha', refers: ['beta'] },
				beta: { name: 'beta', refers: ['charlie'] },
				charlie: { name: 'charlie', refers: ['alpha'] },
				delta: { name: 'delta', refers: [] }
			}
			const result = regroup(cycleInput)

			expect(result.errors.length).toBeGreaterThan(0)
			expect(result.groups.length).toBeGreaterThanOrEqual(2) // delta in one group, cycle in another
		})

		it('returns empty errors for non-cyclic input', () => {
			const result = regroup(mdfix.simple.input)
			expect(result.errors).toEqual([])
		})
	})
})
