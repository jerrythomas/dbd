import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
	entityFromFile,
	entityFromSchemaName,
	entityFromRoleName,
	entityFromExtensionConfig,
	entityFromExportConfig,
	entityFromImportConfig,
	ddlFromEntity,
	generateRoleScript,
	combineEntityScripts,
	importScriptForEntity,
	exportScriptForEntity,
	filterEntitiesForDBML,
	validateEntity,
	getValidEntities,
	getInvalidEntities,
	organizeEntities,
	typesWithSchema,
	typesWithoutSchema,
	allowedTypes,
	defaultExportOptions,
	defaultImportOptions
} from '../src/entity-processor.js'
import { ddlScripts, validations, importScripts, exportScripts } from './fixtures/entities/index.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(__dirname, 'fixtures', 'alternate')

describe('entity-processor', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	afterEach(() => {
		process.chdir(originalPath)
	})

	// --- Constants ---

	describe('constants', () => {
		it('typesWithSchema matches expected', () => {
			expect(typesWithSchema).toEqual(['table', 'view', 'function', 'procedure', 'import'])
		})

		it('typesWithoutSchema matches expected', () => {
			expect(typesWithoutSchema).toEqual(['role', 'schema', 'extension'])
		})

		it('allowedTypes is union of both', () => {
			expect(allowedTypes).toEqual([...typesWithSchema, ...typesWithoutSchema])
		})

		it('defaultExportOptions', () => {
			expect(defaultExportOptions).toEqual({ format: 'csv' })
		})

		it('defaultImportOptions', () => {
			expect(defaultImportOptions).toEqual({ format: 'csv', nullValue: '', truncate: true })
		})
	})

	// --- Entity factories ---

	describe('entityFromFile()', () => {
		it('table path', () => {
			expect(entityFromFile('ddl/table/config/lookups.ddl')).toEqual({
				type: 'table',
				name: 'config.lookups',
				file: 'ddl/table/config/lookups.ddl',
				schema: 'config',
				format: 'ddl'
			})
		})

		it('view path', () => {
			expect(entityFromFile('ddl/view/config/genders.ddl')).toEqual({
				type: 'view',
				name: 'config.genders',
				file: 'ddl/view/config/genders.ddl',
				schema: 'config',
				format: 'ddl'
			})
		})

		it('procedure path', () => {
			expect(entityFromFile('ddl/procedure/staging/import_lookups.ddl')).toEqual({
				type: 'procedure',
				name: 'staging.import_lookups',
				file: 'ddl/procedure/staging/import_lookups.ddl',
				schema: 'staging',
				format: 'ddl'
			})
		})

		it('role path', () => {
			expect(entityFromFile('ddl/role/admin.ddl')).toEqual({
				type: 'role',
				name: 'admin',
				file: 'ddl/role/admin.ddl'
			})
		})

		it('import path', () => {
			expect(entityFromFile('import/staging/lookup.csv')).toEqual({
				type: 'import',
				name: 'staging.lookup',
				file: 'import/staging/lookup.csv',
				schema: 'staging',
				format: 'csv'
			})
		})

		it('invalid path returns null type and name', () => {
			expect(entityFromFile('ddl/table/missing.ddl')).toEqual({
				type: null,
				name: null,
				file: 'ddl/table/missing.ddl'
			})
		})
	})

	describe('entityFromSchemaName()', () => {
		it('creates schema entity', () => {
			expect(entityFromSchemaName('staging')).toEqual({ type: 'schema', name: 'staging' })
		})
	})

	describe('entityFromRoleName()', () => {
		it('creates role entity', () => {
			expect(entityFromRoleName('admin')).toEqual({ type: 'role', name: 'admin' })
		})
	})

	describe('entityFromExtensionConfig()', () => {
		it('string input uses default schema', () => {
			expect(entityFromExtensionConfig('uuid-ossp')).toEqual({
				type: 'extension',
				name: 'uuid-ossp',
				schema: 'public'
			})
		})

		it('object input uses custom schema', () => {
			expect(entityFromExtensionConfig({ pgcrypto: { schema: 'ext' } })).toEqual({
				type: 'extension',
				name: 'pgcrypto',
				schema: 'ext'
			})
		})

		it('custom default schema', () => {
			expect(entityFromExtensionConfig('uuid-ossp', 'extensions')).toEqual({
				type: 'extension',
				name: 'uuid-ossp',
				schema: 'extensions'
			})
		})
	})

	describe('entityFromExportConfig()', () => {
		it('string input uses default format', () => {
			expect(entityFromExportConfig('staging.lookup')).toEqual({
				type: 'export',
				name: 'staging.lookup',
				format: 'csv'
			})
		})

		it('object input overrides format', () => {
			expect(entityFromExportConfig({ 'staging.lookup': { format: 'jsonl' } })).toEqual({
				type: 'export',
				name: 'staging.lookup',
				format: 'jsonl'
			})
		})
	})

	describe('entityFromImportConfig()', () => {
		it('string input uses defaults', () => {
			expect(entityFromImportConfig('staging.lookup')).toEqual({
				type: 'import',
				name: 'staging.lookup',
				format: 'csv',
				nullValue: '',
				truncate: true,
				listed: true,
				schema: 'staging'
			})
		})

		it('object input overrides', () => {
			expect(
				entityFromImportConfig({ 'staging.test': { format: 'jsonl', truncate: false } })
			).toEqual({
				type: 'import',
				name: 'staging.test',
				format: 'jsonl',
				nullValue: '',
				truncate: false,
				listed: true,
				schema: 'staging'
			})
		})
	})

	// --- DDL generation ---

	describe('ddlFromEntity()', () => {
		for (const { input, output, message } of ddlScripts) {
			it(message, () => {
				if (input.file) {
					process.chdir(fixtureDir)
				}
				expect(ddlFromEntity(input)).toBe(output)
			})
		}

		it('returns null for unknown type without file', () => {
			expect(ddlFromEntity({ type: 'table', name: 'test' })).toBeNull()
		})
	})

	describe('generateRoleScript()', () => {
		it('creates idempotent role script', () => {
			const script = generateRoleScript({ name: 'viewer', refers: [] })
			expect(script).toContain('CREATE ROLE viewer')
			expect(script).toContain('IF NOT EXISTS')
		})

		it('includes grants for role dependencies', () => {
			const script = generateRoleScript({ name: 'admin', refers: ['viewer', 'editor'] })
			expect(script).toContain('grant viewer to admin;')
			expect(script).toContain('grant editor to admin;')
		})
	})

	describe('combineEntityScripts()', () => {
		it('combines DDL for valid entities', () => {
			const entities = [
				{ type: 'schema', name: 'public' },
				{ type: 'schema', name: 'staging' },
				{ type: 'table', name: 'test', errors: ['bad'] }
			]
			const combined = combineEntityScripts(entities)
			expect(combined).toContain('create schema if not exists public;')
			expect(combined).toContain('create schema if not exists staging;')
			expect(combined).not.toContain('test')
		})
	})

	// --- Import/export scripts ---

	describe('importScriptForEntity()', () => {
		for (const { input, output, message } of importScripts) {
			it(message, () => {
				expect(importScriptForEntity(input)).toBe(output)
			})
		}
	})

	describe('exportScriptForEntity()', () => {
		for (const { input, output, message } of exportScripts) {
			it(message, () => {
				expect(exportScriptForEntity(input)).toBe(output)
			})
		}
	})

	// --- DBML filtering ---

	describe('filterEntitiesForDBML()', () => {
		const entities = [
			{ type: 'table', name: 'public.users', schema: 'public' },
			{ type: 'table', name: 'staging.data', schema: 'staging' },
			{ type: 'table', name: 'public.orders', schema: 'public' },
			{ type: 'view', name: 'public.user_view', schema: 'public' }
		]

		it('returns only tables', () => {
			const result = filterEntitiesForDBML(entities, {})
			expect(result.every((e) => e.type === 'table')).toBe(true)
			expect(result.length).toBe(3)
		})

		it('filters by include.schemas', () => {
			const result = filterEntitiesForDBML(entities, { include: { schemas: ['public'] } })
			expect(result.every((e) => e.schema === 'public')).toBe(true)
			expect(result.length).toBe(2)
		})

		it('filters by exclude.schemas', () => {
			const result = filterEntitiesForDBML(entities, { exclude: { schemas: ['staging'] } })
			expect(result.every((e) => e.schema !== 'staging')).toBe(true)
			expect(result.length).toBe(2)
		})

		it('filters by include.tables', () => {
			const result = filterEntitiesForDBML(entities, {
				include: { tables: ['public.users'] }
			})
			expect(result.length).toBe(1)
			expect(result[0].name).toBe('public.users')
		})

		it('filters by exclude.tables', () => {
			const result = filterEntitiesForDBML(entities, {
				exclude: { tables: ['public.users'] }
			})
			expect(result.find((e) => e.name === 'public.users')).toBeUndefined()
		})
	})

	// --- Validation ---

	describe('validateEntity()', () => {
		for (const { input, output, message } of validations) {
			it(message, () => {
				process.chdir(fixtureDir)
				expect(validateEntity(input.entity, input.ddl)).toEqual(output)
			})
		}

		it('reports error when entity name is null', () => {
			const entity = { type: null, name: null, file: 'ddl/bad.ddl' }
			const result = validateEntity(entity, false)
			expect(result.errors).toContain('Location of the file is incorrect')
		})

		it('collects errors from references with error property', () => {
			const entity = {
				type: 'table',
				name: 'public.users',
				file: join(fixtureDir, 'ddl', 'test', 'test.ddl'),
				references: [{ name: 'bad_ref', error: 'Parse error in bad_ref' }, { name: 'ok_ref' }]
			}
			process.chdir(fixtureDir)
			const result = validateEntity(entity)
			expect(result.errors).toContain('Parse error in bad_ref')
		})

		it('skips ignored references when collecting errors', () => {
			const entity = {
				type: 'table',
				name: 'public.test',
				file: join(fixtureDir, 'ddl', 'test', 'test.ddl'),
				references: [
					{ name: 'bad_ref', error: 'Parse error in bad_ref' },
					{ name: 'ignored_ref', error: 'Should be ignored' }
				]
			}
			process.chdir(fixtureDir)
			const result = validateEntity(entity, true, ['ignored_ref'])
			expect(result.errors).toContain('Parse error in bad_ref')
			expect(result.errors).not.toContain('Should be ignored')
		})
	})

	describe('getValidEntities()', () => {
		it('returns entities without errors', () => {
			const entities = [{ name: 'a' }, { name: 'b', errors: ['bad'] }, { name: 'c', errors: [] }]
			const valid = getValidEntities(entities)
			expect(valid.map((e) => e.name)).toEqual(['a', 'c'])
		})
	})

	describe('getInvalidEntities()', () => {
		it('returns entities with errors', () => {
			const entities = [{ name: 'a' }, { name: 'b', errors: ['bad'] }, { name: 'c', errors: [] }]
			const invalid = getInvalidEntities(entities)
			expect(invalid.map((e) => e.name)).toEqual(['b'])
		})
	})

	// --- Organization ---

	describe('organizeEntities()', () => {
		it('groups entities by type', () => {
			const entities = [
				{ type: 'table', name: 'a' },
				{ type: 'view', name: 'b' },
				{ type: 'table', name: 'c' },
				{ type: 'role', name: 'd' }
			]
			const groups = organizeEntities(entities)
			expect(groups.table.length).toBe(2)
			expect(groups.view.length).toBe(1)
			expect(groups.role.length).toBe(1)
		})

		it('handles empty input', () => {
			expect(organizeEntities([])).toEqual({})
		})

		it('uses unknown for entities without type', () => {
			const entities = [{ name: 'a' }, { type: 'table', name: 'b' }]
			const groups = organizeEntities(entities)
			expect(groups.unknown.length).toBe(1)
			expect(groups.unknown[0].name).toBe('a')
			expect(groups.table.length).toBe(1)
		})
	})
})
