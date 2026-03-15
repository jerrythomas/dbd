import { describe, it, expect, beforeEach } from 'vitest'
import {
	createAdapter,
	getAdapterInfo,
	registerAdapter,
	SUPPORTED_DATABASES
} from '../src/factory.js'
import { BaseDatabaseAdapter } from '../src/base-adapter.js'

vi.mock('@jerrythomas/dbd-postgres-adapter', () => ({
	createAdapter: (conn, opts) => ({ type: 'mock-postgres', conn, opts, initParser: () => {} })
}))

describe('factory', () => {
	describe('SUPPORTED_DATABASES', () => {
		it('starts empty — adapters must be registered by the caller', () => {
			// postgres is NOT built-in; cli registers it before use
			expect(SUPPORTED_DATABASES).not.toContain('postgres')
			expect(SUPPORTED_DATABASES).not.toContain('postgresql')
		})
	})

	describe('getAdapterInfo()', () => {
		it('returns unsupported for postgres before registration', () => {
			expect(getAdapterInfo('postgres')).toEqual({ type: 'postgres', supported: false })
		})

		it('returns unsupported for unknown type', () => {
			expect(getAdapterInfo('mysql')).toEqual({ type: 'mysql', supported: false })
		})
	})

	describe('createAdapter()', () => {
		it('throws for unsupported database type', async () => {
			await expect(createAdapter('mysql', 'mysql://localhost')).rejects.toThrow(
				'Unsupported database: mysql'
			)
		})

		it('throws before any adapter is registered', async () => {
			await expect(createAdapter('sqlite', 'sqlite://test.db')).rejects.toThrow(
				'Unsupported database: sqlite'
			)
		})
	})

	describe('registerAdapter()', () => {
		it('registers a custom adapter that can be created', async () => {
			class TestAdapter extends BaseDatabaseAdapter {}
			registerAdapter('testdb', () =>
				Promise.resolve({
					createAdapter: (conn, opts) => new TestAdapter(conn, opts)
				})
			)
			expect(getAdapterInfo('testdb').supported).toBe(true)
			const adapter = await createAdapter('testdb', 'testdb://localhost')
			expect(adapter).toBeInstanceOf(TestAdapter)
			expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		})

		it('can register the postgres adapter and create it', async () => {
			registerAdapter('postgres', () => import('@jerrythomas/dbd-postgres-adapter'))
			expect(getAdapterInfo('postgres').supported).toBe(true)
			const adapter = await createAdapter('postgres', 'pg://localhost')
			expect(adapter).toBeDefined()
			expect(adapter.type).toBe('mock-postgres')
			expect(adapter.conn).toBe('pg://localhost')
			expect(typeof adapter.initParser).toBe('function')
		})

		it('can override a registered adapter', async () => {
			class CustomPg extends BaseDatabaseAdapter {}
			registerAdapter('postgres', () =>
				Promise.resolve({
					createAdapter: (conn, opts) => new CustomPg(conn, opts)
				})
			)
			const adapter = await createAdapter('postgres', 'pg://localhost')
			expect(adapter).toBeInstanceOf(CustomPg)
		})

		it('is case-insensitive', () => {
			registerAdapter('MyDB', () => Promise.resolve({}))
			expect(getAdapterInfo('mydb').supported).toBe(true)
		})
	})
})
