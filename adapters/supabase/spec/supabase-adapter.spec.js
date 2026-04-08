import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseAdapter } from '../src/supabase-adapter.js'
import { PgAdapter } from '@jerrythomas/dbd-postgres-adapter'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

// SupabaseAdapter uses PgAdapter internally; mock postgres so no real connection is needed
vi.mock('postgres', () => ({
	default: vi.fn(() => {
		const sql = vi.fn()
		sql.unsafe = vi.fn().mockResolvedValue([])
		sql.end = vi.fn().mockResolvedValue(undefined)
		return sql
	})
}))

describe('SupabaseAdapter', () => {
	let adapter

	beforeEach(() => {
		vi.clearAllMocks()
		adapter = new SupabaseAdapter('postgresql://localhost/test')
	})

	describe('inheritance', () => {
		it('extends PgAdapter', () => {
			expect(adapter).toBeInstanceOf(PgAdapter)
		})

		it('extends BaseDatabaseAdapter', () => {
			expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		})

		it('stores connection string', () => {
			expect(adapter.connectionString).toBe('postgresql://localhost/test')
		})
	})

	describe('applyEntity() — managed schema skip', () => {
		it.each(['auth', 'storage', 'realtime', 'graphql_public', 'supabase_functions'])(
			'skips schema entity "%s"',
			async (name) => {
				const spy = vi.spyOn(adapter, 'executeScript')
				await adapter.applyEntity({ type: 'schema', name })
				expect(spy).not.toHaveBeenCalled()
			}
		)

		it('applies non-managed schema entities normally', async () => {
			const spy = vi.spyOn(adapter, 'executeScript').mockResolvedValue(undefined)
			await adapter.applyEntity({ type: 'schema', name: 'staging' })
			expect(spy).toHaveBeenCalled()
		})
	})

	describe('applyEntity() — pre-installed extension skip', () => {
		it.each(['uuid-ossp', 'pgcrypto', 'pgjwt', 'plpgsql', 'pg_graphql', 'pgsodium'])(
			'skips pre-installed extension "%s"',
			async (name) => {
				const spy = vi.spyOn(adapter, 'executeScript')
				await adapter.applyEntity({ type: 'extension', name, schema: 'extensions' })
				expect(spy).not.toHaveBeenCalled()
			}
		)

		it('applies non-pre-installed extensions normally', async () => {
			const spy = vi.spyOn(adapter, 'executeScript').mockResolvedValue(undefined)
			await adapter.applyEntity({ type: 'extension', name: 'postgis', schema: 'public' })
			expect(spy).toHaveBeenCalled()
		})
	})

	describe('applyEntity() — other entity types pass through', () => {
		it('delegates table entities to PgAdapter', async () => {
			const spy = vi.spyOn(adapter, 'executeFile').mockResolvedValue(undefined)
			await adapter.applyEntity({ type: 'table', name: 'public.users', file: 'users.ddl' })
			expect(spy).toHaveBeenCalledWith('users.ddl', {})
		})
	})

	describe('createAdapter factory', () => {
		it('createAdapter returns a SupabaseAdapter', async () => {
			const { createAdapter } = await import('../src/index.js')
			const a = createAdapter('postgresql://localhost/test')
			expect(a).toBeInstanceOf(SupabaseAdapter)
		})
	})
})
