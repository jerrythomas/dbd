import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		readFileSync: vi.fn(),
		existsSync: vi.fn()
	}
})

import { readFileSync, existsSync } from 'fs'
import {
	ddlFromEntity,
	importScriptForEntity,
	exportScriptForEntity,
	dataFromEntity,
	validateEntityFiles,
	batchImportScript,
	batchExportScript,
	defaultImportOptions,
	defaultExportOptions
} from '../src/scripts.js'

describe('scripts', () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	describe('defaultImportOptions', () => {
		it('has expected defaults', () => {
			expect(defaultImportOptions).toEqual({
				format: 'csv',
				truncate: false,
				nullValue: ''
			})
		})
	})

	describe('defaultExportOptions', () => {
		it('has expected defaults', () => {
			expect(defaultExportOptions).toEqual({ format: 'csv' })
		})
	})

	describe('ddlFromEntity', () => {
		it('reads file content when entity has a file', () => {
			readFileSync.mockReturnValue('CREATE TABLE test (id int);')
			const result = ddlFromEntity({ file: 'ddl/test.ddl' })
			expect(result).toBe('CREATE TABLE test (id int);')
			expect(readFileSync).toHaveBeenCalledWith('ddl/test.ddl', 'utf8')
		})

		it('generates schema DDL', () => {
			const result = ddlFromEntity({ type: 'schema', name: 'config' })
			expect(result).toBe('create schema if not exists config;')
		})

		it('generates extension DDL with default schema', () => {
			const result = ddlFromEntity({ type: 'extension', name: 'uuid-ossp' })
			expect(result).toBe('create extension if not exists "uuid-ossp" with schema public;')
		})

		it('generates extension DDL with custom schema', () => {
			const result = ddlFromEntity({ type: 'extension', name: 'pgcrypto', schema: 'extensions' })
			expect(result).toBe('create extension if not exists "pgcrypto" with schema extensions;')
		})

		it('generates role DDL with grants', () => {
			const result = ddlFromEntity({ type: 'role', name: 'app_user', refers: ['reader', 'writer'] })
			expect(result).toContain('CREATE ROLE app_user')
			expect(result).toContain("rolname = 'app_user'")
			expect(result).toContain('grant reader to app_user;')
			expect(result).toContain('grant writer to app_user;')
		})

		it('returns null for unknown type without file', () => {
			const result = ddlFromEntity({ type: 'unknown', name: 'test' })
			expect(result).toBeNull()
		})
	})

	describe('importScriptForEntity', () => {
		it('generates CSV import script', () => {
			const entity = {
				name: 'staging.lookups',
				file: 'import/staging/lookups.csv',
				format: 'csv',
				truncate: false,
				nullValue: ''
			}
			const result = importScriptForEntity(entity)
			expect(result).toContain("\\copy staging.lookups from 'import/staging/lookups.csv'")
			expect(result).toContain("delimiter E','")
			expect(result).toContain('csv header')
		})

		it('includes truncate when enabled', () => {
			const entity = {
				name: 'staging.data',
				file: 'import/staging/data.csv',
				format: 'csv',
				truncate: true,
				nullValue: ''
			}
			const result = importScriptForEntity(entity)
			expect(result).toContain('truncate table staging.data')
			expect(result).toContain('delete from staging.data')
		})

		it('generates JSON import script', () => {
			const entity = {
				name: 'staging.data',
				file: 'import/staging/data.json',
				format: 'json',
				truncate: false,
				nullValue: ''
			}
			const result = importScriptForEntity(entity)
			expect(result).toContain('create table if not exists _temp (data jsonb)')
			expect(result).toContain("\\copy _temp from 'import/staging/data.json'")
			expect(result).toContain("call staging.import_jsonb_to_table('_temp', 'staging.data')")
			expect(result).toContain('drop table if exists _temp')
		})

		it('generates TSV import script with tab delimiter', () => {
			const entity = {
				name: 'staging.data',
				file: 'import/staging/data.tsv',
				format: 'tsv',
				truncate: false,
				nullValue: ''
			}
			const result = importScriptForEntity(entity)
			expect(result).toContain("delimiter E'\\t'")
		})
	})

	describe('exportScriptForEntity', () => {
		it('generates CSV export script', () => {
			const entity = { name: 'config.lookups', format: 'csv' }
			const result = exportScriptForEntity(entity)
			expect(result).toContain('select * from config.lookups')
			expect(result).toContain("delimiter E','")
			expect(result).toContain('csv header')
		})

		it('generates JSON export script', () => {
			const entity = { name: 'config.lookups', format: 'json' }
			const result = exportScriptForEntity(entity)
			expect(result).toContain('select row_to_json(t) from config.lookups t')
		})

		it('generates TSV export script', () => {
			const entity = { name: 'staging.data', format: 'tsv' }
			const result = exportScriptForEntity(entity)
			expect(result).toContain("delimiter E'\\t'")
		})
	})

	describe('dataFromEntity', () => {
		it('reads JSON files', async () => {
			readFileSync.mockReturnValue('[{"id":1},{"id":2}]')
			const result = await dataFromEntity({ file: 'data.json' })
			expect(result).toEqual([{ id: 1 }, { id: 2 }])
		})

		it('returns empty array for unsupported format', async () => {
			const result = await dataFromEntity({ file: 'data.txt' })
			expect(result).toEqual([])
		})
	})

	describe('validateEntityFiles', () => {
		it('returns empty array for valid DDL entity', () => {
			existsSync.mockReturnValue(true)
			const result = validateEntityFiles({ file: 'ddl/test.ddl', type: 'table' })
			expect(result).toEqual([])
		})

		it('reports missing file', () => {
			existsSync.mockReturnValue(false)
			const result = validateEntityFiles({ file: 'missing.ddl', type: 'table' })
			expect(result).toContain('File does not exist')
		})

		it('reports unsupported DDL file type', () => {
			existsSync.mockReturnValue(true)
			const result = validateEntityFiles({ file: 'test.sql', type: 'table' })
			expect(result).toContain('Unsupported file type for ddl')
		})

		it('validates import file types', () => {
			existsSync.mockReturnValue(true)
			expect(validateEntityFiles({ file: 'data.csv', type: 'import' })).toEqual([])
			expect(validateEntityFiles({ file: 'data.json', type: 'import' })).toEqual([])
			expect(validateEntityFiles({ file: 'data.tsv', type: 'import' })).toEqual([])
			expect(validateEntityFiles({ file: 'data.jsonl', type: 'import' })).toEqual([])
		})

		it('reports unsupported import format', () => {
			existsSync.mockReturnValue(true)
			const result = validateEntityFiles({ file: 'data.xml', type: 'import' })
			expect(result).toContain('Unsupported data format')
		})

		it('returns empty array when no file', () => {
			const result = validateEntityFiles({ type: 'schema', name: 'config' })
			expect(result).toEqual([])
		})
	})

	describe('batchImportScript', () => {
		it('combines import scripts for multiple entities', () => {
			const entities = [
				{ name: 'staging.a', file: 'a.csv', format: 'csv', truncate: false, nullValue: '' },
				{ name: 'staging.b', file: 'b.csv', format: 'csv', truncate: false, nullValue: '' }
			]
			const result = batchImportScript(entities)
			expect(result).toContain('staging.a')
			expect(result).toContain('staging.b')
		})
	})

	describe('batchExportScript', () => {
		it('combines export scripts for multiple entities', () => {
			const entities = [
				{ name: 'config.a', format: 'csv' },
				{ name: 'config.b', format: 'csv' }
			]
			const result = batchExportScript(entities)
			expect(result).toContain('config.a')
			expect(result).toContain('config.b')
		})
	})
})
