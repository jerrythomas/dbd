/**
 * Tests for packages/cli/src/config.js
 *
 * Mirrors spec/compat/config.spec.js but imports from the new package.
 */
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, unlinkSync } from 'fs'
import {
	scan,
	read,
	fillMissingInfoForEntities,
	merge,
	clean,
	cleanDDLEntities,
	normalizeEnv
} from '../src/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..', '..')
const exampleDir = join(repoRoot, 'example')

describe('config', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	afterEach(() => {
		process.chdir(originalPath)
	})

	describe('scan()', () => {
		it('discovers DDL and import files', () => {
			process.chdir(exampleDir)
			const files = scan('ddl')
			expect(files.length).toBeGreaterThan(0)
			expect(files.every((f) => f.startsWith('ddl/'))).toBe(true)
		})
	})

	describe('read()', () => {
		it('parses design.yaml with project info', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(data.project.name).toBe('Example')
			expect(data.project.database).toBe('PostgreSQL')
		})

		it('fills missing entity types with empty arrays', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(Array.isArray(data.tables)).toBe(true)
			expect(Array.isArray(data.views)).toBe(true)
			expect(Array.isArray(data.functions)).toBe(true)
			expect(Array.isArray(data.procedures)).toBe(true)
			expect(Array.isArray(data.roles)).toBe(true)
		})

		it('entities array is union of tables+views+functions+procedures', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			expect(data.entities.length).toBe(
				data.tables.length + data.views.length + data.functions.length + data.procedures.length
			)
		})

		it('defaults schemas to empty array when not in config', () => {
			const tmpFile = join(exampleDir, '_test_no_schemas.yaml')
			writeFileSync(
				tmpFile,
				'project:\n  name: Test\n  database: PostgreSQL\nimport:\n  options: {}\n'
			)
			try {
				process.chdir(exampleDir)
				const data = read('_test_no_schemas.yaml')
				expect(data.schemas).toEqual([])
			} finally {
				unlinkSync(tmpFile)
			}
		})
	})

	describe('fillMissingInfoForEntities()', () => {
		it('fills empty data with default arrays', () => {
			const data = fillMissingInfoForEntities({})
			expect(data.tables).toEqual([])
			expect(data.views).toEqual([])
			expect(data.functions).toEqual([])
			expect(data.procedures).toEqual([])
			expect(data.roles).toEqual([])
		})

		it('adds type and refers to existing entries', () => {
			const data = fillMissingInfoForEntities({
				tables: [{ name: 'a' }],
				views: [{ name: 'b' }]
			})
			expect(data.tables[0]).toEqual({ name: 'a', refers: [], type: 'table' })
			expect(data.views[0]).toEqual({ name: 'b', refers: [], type: 'view' })
		})
	})

	describe('merge()', () => {
		it('y overrides x for matching names', () => {
			const x = [{ name: 'a', value: 1 }]
			const y = [{ name: 'a', value: 2 }]
			const result = merge(x, y)
			expect(result).toEqual([{ name: 'a', value: 2 }])
		})

		it('preserves items only in x', () => {
			const x = [{ name: 'a', value: 1 }]
			const y = [{ name: 'b', value: 2 }]
			const result = merge(x, y)
			expect(result.length).toBe(2)
			expect(result.find((r) => r.name === 'a').value).toBe(1)
			expect(result.find((r) => r.name === 'b').value).toBe(2)
		})

		it('merges x properties into matching y entries', () => {
			const x = [{ name: 'a', x: 1, shared: 'from_x' }]
			const y = [{ name: 'a', y: 2, shared: 'from_y' }]
			const result = merge(x, y)
			expect(result).toEqual([{ name: 'a', x: 1, y: 2, shared: 'from_y' }])
		})
	})

	describe('clean()', () => {
		it('processes DDL entities with extensions from config', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

			const result = clean(data, parseEntity, matchRefs)
			expect(result.schemas.length).toBeGreaterThan(0)
			expect(result.entities.length).toBeGreaterThan(0)
			expect(Array.isArray(result.importTables)).toBe(true)
			expect(Array.isArray(result.roles)).toBe(true)
		})

		it('processes import tables when present in config', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

			const result = clean(data, parseEntity, matchRefs)
			// example config has import.tables with staging.lookup_values
			expect(result.importTables.length).toBeGreaterThan(0)
		})

		it('handles config without import tables', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			// Remove import.tables to hit the nullish coalescing fallback
			delete data.import.tables
			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

			const result = clean(data, parseEntity, matchRefs)
			expect(Array.isArray(result.importTables)).toBe(true)
		})

		it('handles config without schemas', () => {
			process.chdir(exampleDir)
			const data = read('design.yaml')
			delete data.schemas
			data.schemas = undefined

			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

			// clean derives schemas from entity names
			const result = clean({ ...data, schemas: [] }, parseEntity, matchRefs)
			expect(Array.isArray(result.schemas)).toBe(true)
		})
	})

	describe('cleanDDLEntities()', () => {
		it('scans ddl folder with extensions', () => {
			process.chdir(exampleDir)
			const data = {
				extensions: ['uuid-ossp'],
				entities: []
			}
			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities, exts) => {
				expect(exts).toEqual(['uuid-ossp'])
				return entities.map((e) => ({ ...e, warnings: [], refers: [] }))
			}

			const result = cleanDDLEntities(data, parseEntity, matchRefs)
			expect(result.length).toBeGreaterThan(0)
		})

		it('handles missing extensions (nullish)', () => {
			process.chdir(exampleDir)
			const data = { entities: [] }
			const parseEntity = (entity) => ({
				...entity,
				searchPaths: ['public'],
				references: [],
				errors: []
			})
			const matchRefs = (entities, exts) => {
				expect(exts).toEqual([])
				return entities.map((e) => ({ ...e, warnings: [], refers: [] }))
			}

			const result = cleanDDLEntities(data, parseEntity, matchRefs)
			expect(result.length).toBeGreaterThan(0)
		})
	})

	describe('normalizeEnv', () => {
		it('maps "prod" to "prod"', () => {
			expect(normalizeEnv('prod')).toBe('prod')
		})
		it('maps "production" to "prod"', () => {
			expect(normalizeEnv('production')).toBe('prod')
		})
		it('maps "dev" to "dev"', () => {
			expect(normalizeEnv('dev')).toBe('dev')
		})
		it('maps "development" to "dev"', () => {
			expect(normalizeEnv('development')).toBe('dev')
		})
		it('returns "prod" for undefined', () => {
			expect(normalizeEnv(undefined)).toBe('prod')
		})
		it('returns "prod" for null', () => {
			expect(normalizeEnv(null)).toBe('prod')
		})
		it('throws for unrecognized value', () => {
			expect(() => normalizeEnv('staging')).toThrow()
		})
	})

	describe('cleanImportTables env annotation (folder-based)', () => {
		const parseEntity = (entity) => ({
			...entity,
			searchPaths: ['public'],
			references: [],
			errors: []
		})
		const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

		beforeEach(() => process.chdir(exampleDir))

		it('annotates files under import/dev/ with env "dev"', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			const devTable = result.importTables.find((t) => t.name === 'staging.dev_fixtures')
			expect(devTable).toBeDefined()
			expect(devTable.env).toBe('dev')
		})

		it('annotates files under import/prod/ with env "prod"', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			const prodTable = result.importTables.find((t) => t.name === 'staging.prod_seeds')
			expect(prodTable).toBeDefined()
			expect(prodTable.env).toBe('prod')
		})

		it('annotates ungrouped import files with env null (shared)', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			// staging.lookups is at import/staging/lookups.csv — no dev/prod parent folder
			const sharedTable = result.importTables.find((t) => t.name === 'staging.lookups')
			expect(sharedTable).toBeDefined()
			expect(sharedTable.env).toBeNull()
		})
	})

	describe('cleanImportTables env annotation (YAML)', () => {
		const parseEntity = (entity) => ({
			...entity,
			searchPaths: ['public'],
			references: [],
			errors: []
		})
		const matchRefs = (entities) => entities.map((e) => ({ ...e, warnings: [], refers: [] }))

		beforeEach(() => process.chdir(exampleDir))

		it('annotates YAML-listed table with env "dev" when env field is "dev"', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			// staging.dev_fixture_table is in import.tables with env: dev
			const table = result.importTables.find((t) => t.name === 'staging.dev_fixture_table')
			expect(table).toBeDefined()
			expect(table.env).toBe('dev')
		})

		it('annotates YAML-listed table with env null when env is [dev, prod] (explicit shared)', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			// staging.lookup_values has env: [dev, prod] in design.yaml → shared
			const table = result.importTables.find((t) => t.name === 'staging.lookup_values')
			expect(table).toBeDefined()
			expect(table.env).toBeNull()
		})

		it('annotates YAML-listed table with env null when no env field (implicitly shared)', () => {
			const data = read('design.yaml')
			const result = clean(data, parseEntity, matchRefs)
			// staging.lookups is discovered from filesystem with no YAML entry → env from path = null
			const table = result.importTables.find((t) => t.name === 'staging.lookups')
			expect(table).toBeDefined()
			expect(table.env).toBeNull()
		})
	})
})
