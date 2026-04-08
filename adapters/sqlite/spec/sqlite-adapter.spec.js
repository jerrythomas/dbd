import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SqliteAdapter, stripSchema } from '../src/sqlite-adapter.js'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

// mockDb is module-scope so vi.mock factory can reference it (vitest allows `mock`-prefixed vars)
const mockDb = {
	exec: vi.fn(),
	prepare: vi.fn(() => ({
		run: vi.fn(),
		all: vi.fn(() => [])
	})),
	pragma: vi.fn(),
	transaction: vi.fn((fn) => fn),
	close: vi.fn()
}

// Use a regular function (not arrow) so vi.fn works correctly when called with `new`
vi.mock('better-sqlite3', () => ({
	default: vi.fn(function () {
		return mockDb
	})
}))

vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		readFileSync: vi.fn(() => 'CREATE TABLE users (id INTEGER PRIMARY KEY);'),
		existsSync: vi.fn(() => true),
		createReadStream: vi.fn()
	}
})

import Database from 'better-sqlite3'
import { readFileSync } from 'fs'

describe('stripSchema()', () => {
	it('strips schema prefix from qualified name', () => {
		expect(stripSchema('config.profiles')).toBe('profiles')
		expect(stripSchema('public.users')).toBe('users')
	})

	it('returns unqualified names unchanged', () => {
		expect(stripSchema('users')).toBe('users')
	})
})

describe('SqliteAdapter', () => {
	let adapter

	beforeEach(() => {
		vi.clearAllMocks()
		adapter = new SqliteAdapter('./test.db')
	})

	describe('inheritance', () => {
		it('extends BaseDatabaseAdapter', () => {
			expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		})

		it('stores connection string as file path', () => {
			expect(adapter.connectionString).toBe('./test.db')
		})
	})

	describe('connect() / disconnect()', () => {
		it('connect() opens a database', async () => {
			await adapter.connect()
			expect(Database).toHaveBeenCalledWith('./test.db')
		})

		it('disconnect() closes the database', async () => {
			await adapter.connect()
			await adapter.disconnect()
			expect(mockDb.close).toHaveBeenCalled()
		})

		it('disconnect() is a no-op when not connected', async () => {
			await expect(adapter.disconnect()).resolves.toBeUndefined()
		})
	})

	describe('executeScript()', () => {
		it('executes SQL via db.exec()', async () => {
			await adapter.connect()
			await adapter.executeScript('CREATE TABLE t (id INTEGER);')
			expect(mockDb.exec).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER);')
		})

		it('skips execution in dryRun mode', async () => {
			const dryAdapter = new SqliteAdapter('./test.db', { dryRun: true })
			await dryAdapter.connect()
			await dryAdapter.executeScript('CREATE TABLE t (id INTEGER);')
			expect(mockDb.exec).not.toHaveBeenCalled()
		})
	})

	describe('applyEntity() — unsupported types', () => {
		it.each(['schema', 'extension', 'role'])(
			'skips %s entities (not supported by SQLite)',
			async (type) => {
				await adapter.connect()
				await adapter.applyEntity({ type, name: 'x' })
				expect(mockDb.exec).not.toHaveBeenCalled()
			}
		)
	})

	describe('applyEntity() — table', () => {
		it('reads file and executes DDL', async () => {
			await adapter.connect()
			const entity = { type: 'table', name: 'public.users', file: 'ddl/table/public/users.ddl' }
			await adapter.applyEntity(entity)
			expect(readFileSync).toHaveBeenCalledWith(entity.file, 'utf-8')
			expect(mockDb.exec).toHaveBeenCalled()
		})

		it('skips entities with errors', async () => {
			await adapter.connect()
			const entity = { type: 'table', name: 'bad', errors: ['File not found'] }
			await adapter.applyEntity(entity)
			expect(mockDb.exec).not.toHaveBeenCalled()
		})

		it('skips execution in dryRun mode', async () => {
			const dryAdapter = new SqliteAdapter('./test.db', { dryRun: true })
			await dryAdapter.connect()
			await dryAdapter.applyEntity({ type: 'table', name: 'public.users', file: 'users.ddl' })
			expect(mockDb.exec).not.toHaveBeenCalled()
		})
	})

	describe('importData()', () => {
		it('skips entities with errors', async () => {
			await adapter.connect()
			await adapter.importData({ name: 'bad', errors: ['missing file'] })
			expect(mockDb.prepare).not.toHaveBeenCalled()
		})

		it('skips in dryRun mode', async () => {
			const dryAdapter = new SqliteAdapter('./test.db', { dryRun: true })
			await dryAdapter.connect()
			await dryAdapter.importData({
				name: 'public.users',
				file: 'data.csv',
				format: 'csv',
				errors: []
			})
			expect(mockDb.prepare).not.toHaveBeenCalled()
		})
	})

	describe('inspect()', () => {
		it('returns connected and sqlite version', async () => {
			await adapter.connect()
			mockDb.pragma.mockReturnValue([{ user_version: 0 }])
			const info = await adapter.inspect()
			expect(info.connected).toBe(true)
			expect(info.version).toContain('SQLite')
		})

		it('returns disconnected when not open', async () => {
			const info = await adapter.inspect()
			expect(info.connected).toBe(false)
		})
	})

	describe('stub methods', () => {
		it('prefersBatchApply() returns false', () => {
			expect(adapter.prefersBatchApply()).toBe(false)
		})

		it('parseEntityScript returns entity with empty references', () => {
			const entity = { type: 'table', name: 'public.users', file: 'u.ddl', schema: 'public' }
			const result = adapter.parseEntityScript(entity)
			expect(result).toMatchObject({ ...entity, searchPaths: [], references: [], errors: [] })
		})
	})
})
