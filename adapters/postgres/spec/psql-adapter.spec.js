import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PsqlAdapter } from '../src/psql-adapter.js'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

// Mock child_process.execSync
vi.mock('child_process', () => ({
	execSync: vi.fn()
}))

// Mock fs for temp file operations
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		writeFileSync: vi.fn(),
		unlinkSync: vi.fn(),
		existsSync: vi.fn(() => true)
	}
})

import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'

describe('PsqlAdapter', () => {
	let adapter

	beforeEach(() => {
		vi.resetAllMocks()
		existsSync.mockReturnValue(true)
		adapter = new PsqlAdapter('postgresql://localhost/testdb', { verbose: false })
	})

	describe('constructor', () => {
		it('extends BaseDatabaseAdapter', () => {
			expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		})

		it('stores connection string', () => {
			expect(adapter.connectionString).toBe('postgresql://localhost/testdb')
		})

		it('stores options', () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', {
				verbose: true,
				dryRun: true
			})
			expect(a.verbose).toBe(true)
			expect(a.dryRun).toBe(true)
		})
	})

	describe('connect()', () => {
		it('resolves without error (stateless)', async () => {
			await expect(adapter.connect()).resolves.toBeUndefined()
		})
	})

	describe('disconnect()', () => {
		it('resolves without error (stateless)', async () => {
			await expect(adapter.disconnect()).resolves.toBeUndefined()
		})
	})

	describe('testConnection()', () => {
		it('returns true when psql succeeds', async () => {
			execSync.mockReturnValue('')
			expect(await adapter.testConnection()).toBe(true)
			expect(execSync).toHaveBeenCalledWith('psql postgresql://localhost/testdb -c "SELECT 1"', {
				stdio: 'pipe'
			})
		})

		it('returns false when psql fails', async () => {
			execSync.mockImplementation(() => {
				throw new Error('connection refused')
			})
			expect(await adapter.testConnection()).toBe(false)
		})
	})

	describe('inspect()', () => {
		it('returns version when connected', async () => {
			execSync.mockReturnValue('  PostgreSQL 15.4  ')
			const info = await adapter.inspect()
			expect(info).toEqual({ connected: true, version: 'PostgreSQL 15.4' })
		})

		it('returns disconnected on failure', async () => {
			execSync.mockImplementation(() => {
				throw new Error('connection refused')
			})
			const info = await adapter.inspect()
			expect(info).toEqual({ connected: false, version: null })
		})
	})

	describe('executeScript()', () => {
		it('writes script to temp file and executes via psql', async () => {
			await adapter.executeScript('CREATE TABLE test (id int);')
			expect(writeFileSync).toHaveBeenCalledWith('_dbd_temp.sql', 'CREATE TABLE test (id int);')
			expect(execSync).toHaveBeenCalledWith('psql postgresql://localhost/testdb < _dbd_temp.sql', {
				stdio: 'pipe'
			})
			expect(unlinkSync).toHaveBeenCalledWith('_dbd_temp.sql')
		})

		it('cleans up temp file on error', async () => {
			execSync.mockImplementation(() => {
				throw new Error('syntax error')
			})
			await expect(adapter.executeScript('BAD SQL')).rejects.toThrow('syntax error')
			expect(unlinkSync).toHaveBeenCalledWith('_dbd_temp.sql')
		})

		it('skips execution in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true })
			await a.executeScript('CREATE TABLE test (id int);')
			expect(execSync).not.toHaveBeenCalled()
			expect(writeFileSync).not.toHaveBeenCalled()
		})

		it('respects per-call dryRun option', async () => {
			await adapter.executeScript('CREATE TABLE test (id int);', { dryRun: true })
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('executeFile()', () => {
		it('executes file via psql', async () => {
			await adapter.executeFile('schema.ddl')
			expect(execSync).toHaveBeenCalledWith('psql postgresql://localhost/testdb < schema.ddl', {
				stdio: 'pipe'
			})
		})

		it('skips execution in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true })
			await a.executeFile('schema.ddl')
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('applyEntity()', () => {
		it('executes file for file-backed entity', async () => {
			const entity = {
				type: 'table',
				name: 'public.users',
				file: 'ddl/table/public/users.ddl'
			}
			await adapter.applyEntity(entity)
			expect(execSync).toHaveBeenCalledWith(
				'psql postgresql://localhost/testdb < ddl/table/public/users.ddl',
				{ stdio: 'pipe' }
			)
		})

		it('generates DDL for schema entity', async () => {
			const entity = { type: 'schema', name: 'staging' }
			await adapter.applyEntity(entity)
			expect(writeFileSync).toHaveBeenCalledWith(
				'_dbd_temp.sql',
				'create schema if not exists staging;'
			)
			expect(execSync).toHaveBeenCalled()
		})

		it('skips entities with errors', async () => {
			const entity = {
				type: 'table',
				name: 'bad',
				errors: ['File not found']
			}
			await adapter.applyEntity(entity)
			expect(execSync).not.toHaveBeenCalled()
		})

		it('skips execution in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true })
			const entity = {
				type: 'schema',
				name: 'staging'
			}
			await a.applyEntity(entity)
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('importData()', () => {
		it('generates import script and executes', async () => {
			const entity = {
				type: 'import',
				name: 'staging.lookup',
				file: 'import/staging/lookup.csv',
				format: 'csv',
				nullValue: '',
				truncate: true
			}
			await adapter.importData(entity)
			expect(writeFileSync).toHaveBeenCalledWith(
				'_dbd_temp.sql',
				expect.stringContaining('staging.lookup')
			)
			expect(execSync).toHaveBeenCalled()
		})

		it('skips entities with errors', async () => {
			const entity = { name: 'bad', errors: ['missing file'] }
			await adapter.importData(entity)
			expect(execSync).not.toHaveBeenCalled()
		})

		it('skips execution in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true })
			await a.importData({ name: 'staging.lookup', format: 'csv' })
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('exportData()', () => {
		it('generates export script and executes', async () => {
			const entity = { name: 'staging.lookup', format: 'csv' }
			await adapter.exportData(entity)
			expect(writeFileSync).toHaveBeenCalledWith(
				'_dbd_temp.sql',
				expect.stringContaining('staging.lookup')
			)
			expect(execSync).toHaveBeenCalled()
		})

		it('skips execution in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true })
			await a.exportData({ name: 'staging.lookup', format: 'csv' })
			expect(execSync).not.toHaveBeenCalled()
		})
	})

	describe('batch operations (inherited)', () => {
		it('applyEntities calls applyEntity for each', async () => {
			const entities = [
				{ type: 'schema', name: 'public' },
				{ type: 'schema', name: 'staging' }
			]
			await adapter.applyEntities(entities)
			// 2 schemas = 2 execSync calls (one per executeScript)
			expect(execSync).toHaveBeenCalledTimes(2)
		})

		it('batchImport calls importData for each', async () => {
			const entities = [
				{
					name: 'staging.a',
					file: 'a.csv',
					format: 'csv',
					nullValue: '',
					truncate: false
				},
				{
					name: 'staging.b',
					file: 'b.csv',
					format: 'csv',
					nullValue: '',
					truncate: false
				}
			]
			await adapter.batchImport(entities)
			expect(execSync).toHaveBeenCalledTimes(2)
		})
	})
})
