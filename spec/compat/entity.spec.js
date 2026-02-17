/**
 * Compatibility test suite for entity transformations (src/entity.js).
 *
 * Snapshots the entity creation, DDL generation, import/export script
 * generation, and validation behaviors with known inputs.
 *
 * Every subsequent migration batch must keep these tests green.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
	entityFromFile,
	entityFromSchemaName,
	entityFromRoleName,
	entityFromExportConfig,
	entityFromImportConfig,
	entityFromExtensionConfig,
	ddlFromEntity,
	validateEntityFile,
	importScriptForEntity,
	exportScriptForEntity,
	entitiesForDBML
} from '../../src/entity.js'
import {
	ddlScripts,
	validations,
	importScripts,
	exportScripts
} from '../fixtures/entities/index.js'

describe('Entity transformation compatibility', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
	})

	afterEach(() => {
		process.chdir(originalPath)
	})

	// --- entityFromFile ---

	describe('entityFromFile()', () => {
		it('table/schema/name.ddl → { type, name, file, schema, format }', () => {
			expect(entityFromFile('ddl/table/config/lookups.ddl')).toEqual({
				type: 'table',
				name: 'config.lookups',
				file: 'ddl/table/config/lookups.ddl',
				schema: 'config',
				format: 'ddl'
			})
		})

		it('view/schema/name.ddl → { type, name, file, schema, format }', () => {
			expect(entityFromFile('ddl/view/config/genders.ddl')).toEqual({
				type: 'view',
				name: 'config.genders',
				file: 'ddl/view/config/genders.ddl',
				schema: 'config',
				format: 'ddl'
			})
		})

		it('procedure/schema/name.ddl → { type, name, file, schema, format }', () => {
			expect(entityFromFile('ddl/procedure/staging/import_lookups.ddl')).toEqual({
				type: 'procedure',
				name: 'staging.import_lookups',
				file: 'ddl/procedure/staging/import_lookups.ddl',
				schema: 'staging',
				format: 'ddl'
			})
		})

		it('role/name.ddl → { type, name, file } (no schema)', () => {
			expect(entityFromFile('ddl/role/admin.ddl')).toEqual({
				type: 'role',
				name: 'admin',
				file: 'ddl/role/admin.ddl'
			})
		})

		it('import/schema/name.csv → { type: import, format: csv }', () => {
			expect(entityFromFile('import/staging/lookup.csv')).toEqual({
				type: 'import',
				name: 'staging.lookup',
				file: 'import/staging/lookup.csv',
				schema: 'staging',
				format: 'csv'
			})
		})

		it('invalid path structure → { type: null, name: null }', () => {
			expect(entityFromFile('ddl/test.ddl')).toEqual({
				type: null,
				name: null,
				file: 'ddl/test.ddl'
			})
		})
	})

	// --- entityFrom*Config factories ---

	describe('entityFromSchemaName()', () => {
		it('creates schema entity', () => {
			expect(entityFromSchemaName('public')).toEqual({ type: 'schema', name: 'public' })
		})
	})

	describe('entityFromRoleName()', () => {
		it('creates role entity', () => {
			expect(entityFromRoleName('admin')).toEqual({ type: 'role', name: 'admin' })
		})
	})

	describe('entityFromExportConfig()', () => {
		it('string input → { type: export, name, format: csv }', () => {
			expect(entityFromExportConfig('core.lookup')).toEqual({
				type: 'export',
				name: 'core.lookup',
				format: 'csv'
			})
		})

		it('object input → overrides format', () => {
			expect(entityFromExportConfig({ 'core.lookup': { format: 'jsonl' } })).toEqual({
				type: 'export',
				name: 'core.lookup',
				format: 'jsonl'
			})
		})
	})

	describe('entityFromImportConfig()', () => {
		it('string input → default import options', () => {
			expect(entityFromImportConfig('staging.lookup')).toEqual({
				type: 'import',
				name: 'staging.lookup',
				schema: 'staging',
				format: 'csv',
				nullValue: '',
				listed: true,
				truncate: true
			})
		})

		it('object input → overrides format', () => {
			expect(entityFromImportConfig({ 'staging.lookup': { format: 'json' } })).toEqual({
				type: 'import',
				name: 'staging.lookup',
				schema: 'staging',
				format: 'json',
				nullValue: '',
				listed: true,
				truncate: true
			})
		})

		it('object input → overrides truncate', () => {
			expect(entityFromImportConfig({ 'staging.lookup': { truncate: false } })).toEqual({
				type: 'import',
				name: 'staging.lookup',
				schema: 'staging',
				format: 'csv',
				nullValue: '',
				listed: true,
				truncate: false
			})
		})

		it('object input → overrides nullValue', () => {
			expect(entityFromImportConfig({ 'staging.lookup': { nullValue: 'NULL' } })).toEqual({
				type: 'import',
				name: 'staging.lookup',
				schema: 'staging',
				format: 'csv',
				nullValue: 'NULL',
				listed: true,
				truncate: true
			})
		})
	})

	describe('entityFromExtensionConfig()', () => {
		it('string input → default schema public', () => {
			expect(entityFromExtensionConfig('uuid-ossp')).toEqual({
				type: 'extension',
				name: 'uuid-ossp',
				schema: 'public'
			})
		})

		it('object input → overrides schema', () => {
			expect(entityFromExtensionConfig({ 'uuid-ossp': { schema: 'extensions' } })).toEqual({
				type: 'extension',
				name: 'uuid-ossp',
				schema: 'extensions'
			})
		})

		it('respects defaultSchema parameter', () => {
			expect(entityFromExtensionConfig('pgcrypto', 'ext')).toEqual({
				type: 'extension',
				name: 'pgcrypto',
				schema: 'ext'
			})
		})
	})

	// --- ddlFromEntity ---

	describe('ddlFromEntity()', () => {
		it('generates DDL for all fixture entity types', () => {
			process.chdir('spec/fixtures/alternate')
			ddlScripts.forEach(({ input, output, message }) => {
				expect(ddlFromEntity(input)).toEqual(output)
			})
		})

		it('schema entity → CREATE SCHEMA', () => {
			expect(ddlFromEntity({ type: 'schema', name: 'private' })).toBe(
				'create schema if not exists private;'
			)
		})

		it('extension entity → CREATE EXTENSION', () => {
			expect(ddlFromEntity({ type: 'extension', name: 'uuid-ossp' })).toBe(
				'create extension if not exists "uuid-ossp" with schema public;'
			)
		})

		it('extension entity with custom schema', () => {
			expect(ddlFromEntity({ type: 'extension', name: 'uuid-ossp', schema: 'extensions' })).toBe(
				'create extension if not exists "uuid-ossp" with schema extensions;'
			)
		})

		it('role entity without refers → DO block only', () => {
			const result = ddlFromEntity({ type: 'role', name: 'basic', refers: [] })
			expect(result).toContain('CREATE ROLE basic')
			expect(result).toContain('IF NOT EXISTS')
			expect(result).not.toContain('grant')
		})

		it('role entity with refers → DO block + grants', () => {
			const result = ddlFromEntity({ type: 'role', name: 'advanced', refers: ['basic'] })
			expect(result).toContain('CREATE ROLE advanced')
			expect(result).toContain('grant basic to advanced;')
		})

		it('entity without file or known type → null', () => {
			expect(ddlFromEntity({ type: 'unknown', name: 'x' })).toBeNull()
		})
	})

	// --- validateEntityFile ---

	describe('validateEntityFile()', () => {
		it('validates all fixture cases', () => {
			process.chdir('spec/fixtures/alternate')
			validations.forEach(({ input, output }) => {
				expect(validateEntityFile(input.entity, input.ddl)).toEqual(output)
			})
		})

		it('invalid path structure → multiple errors', () => {
			const entity = entityFromFile('ddl/test.ddl')
			const result = validateEntityFile(entity)

			expect(result.errors).toContain('Location of the file is incorrect')
			expect(result.errors).toContain('Unknown or unsupported entity type.')
			expect(result.errors).toContain('Unknown or unsupported entity ddl script.')
			expect(result.errors).toContain('File does not exist')
		})

		it('table without qualified name → error', () => {
			const result = validateEntityFile({ type: 'table', name: 'test' })
			expect(result.errors).toContain('Use fully qualified name <schema>.<name>')
			expect(result.errors).toContain('File missing for import entity')
		})

		it('extension with file → error', () => {
			process.chdir('spec/fixtures/alternate')
			const result = validateEntityFile(
				{ type: 'extension', name: 'test', file: 'ddl/test.ddl' },
				true
			)
			expect(result.errors).toContain('"extension" does not need a ddl file.')
		})

		it('schema entity (valid) → no errors property', () => {
			const result = validateEntityFile({ type: 'schema', name: 'test' })
			expect(result.errors).toBeUndefined()
		})

		it('extension entity (valid) → no errors property', () => {
			const result = validateEntityFile({ type: 'extension', name: 'test' })
			expect(result.errors).toBeUndefined()
		})
	})

	// --- importScriptForEntity ---

	describe('importScriptForEntity()', () => {
		it('generates import scripts for all fixture cases', () => {
			importScripts.forEach(({ input, output }) => {
				expect(importScriptForEntity(input)).toEqual(output)
			})
		})

		it('CSV with truncate → truncate DO block + \\copy', () => {
			const script = importScriptForEntity({
				type: 'import',
				name: 'staging.lookup',
				file: 'lookup.csv',
				format: 'csv',
				nullValue: '',
				truncate: true
			})

			expect(script).toContain('truncate table staging.lookup')
			expect(script).toContain('delete from staging.lookup')
			expect(script).toContain("\\copy staging.lookup from 'lookup.csv'")
			expect(script).toContain("delimiter E','")
			expect(script).toContain('csv header')
		})

		it('JSON/JSONL → temp table + procedure call', () => {
			const script = importScriptForEntity({
				type: 'import',
				name: 'staging.test',
				file: 'lookup.jsonl',
				format: 'jsonl',
				nullValue: '',
				truncate: false
			})

			expect(script).toContain('create table if not exists _temp (data jsonb)')
			expect(script).toContain("\\copy _temp from 'lookup.jsonl'")
			expect(script).toContain("call staging.import_jsonb_to_table('_temp', 'staging.test')")
			expect(script).toContain('drop table if exists _temp')
			expect(script).not.toContain('truncate')
		})
	})

	// --- exportScriptForEntity ---

	describe('exportScriptForEntity()', () => {
		it('generates export scripts for all fixture cases', () => {
			exportScripts.forEach(({ input, output, message }) => {
				expect(exportScriptForEntity(input)).toEqual(output)
			})
		})

		it('default CSV → \\copy with tab delimiter', () => {
			const script = exportScriptForEntity({ name: 'staging.lookup' })
			expect(script).toContain(
				"\\copy (select * from staging.lookup) to 'export/staging/lookup.csv'"
			)
			expect(script).toContain("delimiter E'\\t'")
			expect(script).toContain('csv header')
		})

		it('JSONL → \\copy with row_to_json', () => {
			const script = exportScriptForEntity({ name: 'staging.lookup', format: 'jsonl' })
			expect(script).toContain('row_to_json(t)')
			expect(script).toContain("to 'export/staging/lookup.jsonl'")
		})
	})

	// --- entitiesForDBML ---

	describe('entitiesForDBML()', () => {
		const entities = [
			{ type: 'schema', name: 'config' },
			{ type: 'extension', name: 'uuid-ossp' },
			{ type: 'table', name: 'config.lookups', schema: 'config' },
			{ type: 'table', name: 'config.lookup_values', schema: 'config' },
			{ type: 'table', name: 'staging.lookups', schema: 'staging' },
			{ type: 'view', name: 'config.genders', schema: 'config' },
			{ type: 'procedure', name: 'staging.import_lookups', schema: 'staging' }
		]

		it('filters to only tables', () => {
			const result = entitiesForDBML(entities, {})
			result.forEach((e) => expect(e.type).toBe('table'))
		})

		it('include.schemas filters to matching schemas', () => {
			const result = entitiesForDBML(entities, { include: { schemas: ['config'] } })
			expect(result).toHaveLength(2)
			result.forEach((e) => expect(e.schema).toBe('config'))
		})

		it('exclude.schemas removes matching schemas', () => {
			const result = entitiesForDBML(entities, { exclude: { schemas: ['staging'] } })
			expect(result.some((e) => e.schema === 'staging')).toBe(false)
			expect(result).toHaveLength(2) // only config tables
		})

		it('include.tables filters to specific tables', () => {
			const result = entitiesForDBML(entities, {
				include: { tables: ['config.lookups'] }
			})
			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('config.lookups')
		})

		it('exclude.tables removes specific tables', () => {
			const result = entitiesForDBML(entities, {
				exclude: { tables: ['config.lookups'] }
			})
			expect(result.some((e) => e.name === 'config.lookups')).toBe(false)
		})

		it('empty config returns all tables', () => {
			const result = entitiesForDBML(entities, {})
			expect(result).toHaveLength(3) // all 3 tables
		})
	})
})
