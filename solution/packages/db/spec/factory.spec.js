import { describe, it, expect, vi } from 'vitest'
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
		it('includes postgres and postgresql', () => {
			expect(SUPPORTED_DATABASES).toContain('postgres')
			expect(SUPPORTED_DATABASES).toContain('postgresql')
		})
	})

	describe('getAdapterInfo()', () => {
		it('returns supported for postgres', () => {
			expect(getAdapterInfo('postgres')).toEqual({ type: 'postgres', supported: true })
		})

		it('returns supported for postgresql (alias)', () => {
			expect(getAdapterInfo('postgresql')).toEqual({ type: 'postgresql', supported: true })
		})

		it('is case-insensitive', () => {
			expect(getAdapterInfo('POSTGRES')).toEqual({ type: 'postgres', supported: true })
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

		it('throws with helpful message listing supported databases', async () => {
			await expect(createAdapter('sqlite', 'sqlite://test.db')).rejects.toThrow(
				'Supported: postgres, postgresql'
			)
		})
	})

	describe('createAdapter() — built-in loader', () => {
		it('uses the built-in postgres loader when no override registered', async () => {
			const adapter = await createAdapter('postgres', 'pg://localhost')
			expect(adapter).toBeDefined()
			expect(adapter.type).toBe('mock-postgres')
			expect(adapter.conn).toBe('pg://localhost')
			expect(typeof adapter.initParser).toBe('function')
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

		it('can override a built-in adapter', async () => {
			class CustomPg extends BaseDatabaseAdapter {}
			const originalInfo = getAdapterInfo('postgres')
			expect(originalInfo.supported).toBe(true)

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
