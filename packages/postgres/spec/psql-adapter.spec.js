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
			expect(execSync).toHaveBeenCalledWith(
				'psql postgresql://localhost/testdb -v ON_ERROR_STOP=1 < _dbd_temp.sql',
				{ stdio: 'pipe', encoding: 'utf8' }
			)
			expect(unlinkSync).toHaveBeenCalledWith('_dbd_temp.sql')
		})

		it('cleans up temp file on error', async () => {
			execSync.mockImplementation(() => {
				throw new Error('syntax error')
			})
			await expect(adapter.executeScript('BAD SQL')).rejects.toThrow('syntax error')
			expect(unlinkSync).toHaveBeenCalledWith('_dbd_temp.sql')
		})

		it('throws with psql stderr when available', async () => {
			const err = new Error('psql failed')
			err.stderr = 'ERROR:  relation "test" does not exist'
			execSync.mockImplementation(() => {
				throw err
			})
			await expect(adapter.executeScript('BAD SQL')).rejects.toThrow(
				'ERROR:  relation "test" does not exist'
			)
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
			expect(execSync).toHaveBeenCalledWith(
				'psql postgresql://localhost/testdb -v ON_ERROR_STOP=1 < schema.ddl',
				{ stdio: 'pipe', encoding: 'utf8' }
			)
		})

		it('throws with psql stderr on failure', async () => {
			const err = new Error('psql failed')
			err.stderr = 'ERROR:  syntax error at or near "BAD"'
			execSync.mockImplementation(() => {
				throw err
			})
			await expect(adapter.executeFile('bad.sql')).rejects.toThrow(
				'ERROR:  syntax error at or near "BAD"'
			)
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
				'psql postgresql://localhost/testdb -v ON_ERROR_STOP=1 < ddl/table/public/users.ddl',
				{ stdio: 'pipe', encoding: 'utf8' }
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

		it('shows using info for extension in dryRun mode', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true, verbose: true })
			const logs = []
			a.log = (msg) => logs.push(msg)
			await a.applyEntity({ type: 'extension', name: 'uuid-ossp', schema: 'public' })
			expect(logs.some((l) => l.includes('using') && l.includes('public'))).toBe(true)
		})

		it('shows no using info for entity without file or extension type in dryRun', async () => {
			const a = new PsqlAdapter('postgresql://localhost/testdb', { dryRun: true, verbose: true })
			const logs = []
			a.log = (msg) => logs.push(msg)
			await a.applyEntity({ type: 'schema', name: 'staging' })
			expect(logs.some((l) => l.includes('using'))).toBe(false)
		})
	})

	describe('executeScript() — existsSync false branch (line 68)', () => {
		it('skips unlinkSync when temp file does not exist after error', async () => {
			existsSync.mockReturnValue(false)
			execSync.mockImplementation(() => {
				throw new Error('syntax error')
			})
			await expect(adapter.executeScript('BAD SQL')).rejects.toThrow('syntax error')
			// existsSync returns false → unlinkSync should NOT be called
			expect(unlinkSync).not.toHaveBeenCalled()
		})
	})

	describe('applyEntity() — ddl is falsy branch (line 101)', () => {
		it('does not call executeScript when ddlFromEntity returns null', async () => {
			// Entity with no file and a type that produces null DDL
			// 'view' type has no ddlFromEntity implementation — returns null/undefined
			const entity = { type: 'view', name: 'public.my_view' }
			await adapter.applyEntity(entity)
			// writeFileSync (used by executeScript) should NOT be called
			expect(writeFileSync).not.toHaveBeenCalled()
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

	describe('resolveEntity()', () => {
		it('resolves a qualified table name via pg_class', async () => {
			execSync.mockReturnValueOnce('users|public|r')
			const result = await adapter.resolveEntity('public.users')
			expect(result).toEqual({ name: 'public.users', schema: 'public', type: 'table' })
		})

		it('resolves a qualified view name via pg_class', async () => {
			execSync.mockReturnValueOnce('active_users|reporting|v')
			const result = await adapter.resolveEntity('reporting.active_users')
			expect(result).toEqual({ name: 'reporting.active_users', schema: 'reporting', type: 'view' })
		})

		it('resolves a materialized view via pg_class', async () => {
			execSync.mockReturnValueOnce('summary|analytics|m')
			const result = await adapter.resolveEntity('analytics.summary')
			expect(result).toEqual({ name: 'analytics.summary', schema: 'analytics', type: 'view' })
		})

		it('falls back to table type for unknown relkind', async () => {
			execSync.mockReturnValueOnce('seq|public|S')
			const result = await adapter.resolveEntity('public.seq')
			expect(result).toEqual({ name: 'public.seq', schema: 'public', type: 'table' })
		})

		it('falls back to function type for unknown prokind', async () => {
			execSync.mockReturnValueOnce('').mockReturnValueOnce('my_agg|public|x')
			const result = await adapter.resolveEntity('public.my_agg')
			expect(result).toEqual({ name: 'public.my_agg', schema: 'public', type: 'function' })
		})

		it('falls back to pg_proc when pg_class finds nothing', async () => {
			// First call (pg_class) returns empty, second call (pg_proc) returns function
			execSync.mockReturnValueOnce('').mockReturnValueOnce('do_stuff|public|f')
			const result = await adapter.resolveEntity('public.do_stuff')
			expect(result).toEqual({ name: 'public.do_stuff', schema: 'public', type: 'function' })
		})

		it('resolves procedure via pg_proc', async () => {
			execSync.mockReturnValueOnce('').mockReturnValueOnce('run_job|batch|p')
			const result = await adapter.resolveEntity('batch.run_job')
			expect(result).toEqual({ name: 'batch.run_job', schema: 'batch', type: 'procedure' })
		})

		it('returns null when entity not found in any catalog', async () => {
			execSync.mockReturnValue('')
			const result = await adapter.resolveEntity('public.nonexistent')
			expect(result).toBeNull()
		})

		it('uses searchPaths for unqualified names', async () => {
			execSync.mockReturnValueOnce('items|staging|r')
			const result = await adapter.resolveEntity('items', ['staging', 'public'])
			expect(result).toEqual({ name: 'staging.items', schema: 'staging', type: 'table' })
		})

		it('tries multiple searchPaths until found', async () => {
			// First schema (staging) — pg_class empty, pg_proc empty
			execSync
				.mockReturnValueOnce('')
				.mockReturnValueOnce('')
				// Second schema (public) — pg_class returns table
				.mockReturnValueOnce('items|public|r')
			const result = await adapter.resolveEntity('items', ['staging', 'public'])
			expect(result).toEqual({ name: 'public.items', schema: 'public', type: 'table' })
		})

		it('handles pg_class query failure gracefully', async () => {
			execSync
				.mockImplementationOnce(() => {
					throw new Error('connection refused')
				})
				.mockReturnValueOnce('do_stuff|public|f')
			const result = await adapter.resolveEntity('public.do_stuff')
			expect(result).toEqual({ name: 'public.do_stuff', schema: 'public', type: 'function' })
		})

		it('handles both queries failing gracefully', async () => {
			execSync.mockImplementation(() => {
				throw new Error('connection refused')
			})
			const result = await adapter.resolveEntity('public.anything')
			expect(result).toBeNull()
		})

		it('defaults searchPaths to public', async () => {
			execSync.mockReturnValueOnce('users|public|r')
			const result = await adapter.resolveEntity('users')
			expect(result).toEqual({ name: 'public.users', schema: 'public', type: 'table' })
			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining("nspname = 'public'"),
				expect.any(Object)
			)
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
