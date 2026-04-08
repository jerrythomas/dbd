import { describe, it, expect } from 'vitest'
import { createAdapter, PsqlAdapter, PgAdapter } from '../src/index.js'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

describe('adapter factory', () => {
	it('exports PsqlAdapter', () => {
		expect(PsqlAdapter).toBeDefined()
		expect(PsqlAdapter.prototype).toBeInstanceOf(BaseDatabaseAdapter)
	})

	it('exports PgAdapter', () => {
		expect(PgAdapter).toBeDefined()
		expect(PgAdapter.prototype).toBeInstanceOf(BaseDatabaseAdapter)
	})

	it('createAdapter returns a PgAdapter instance', () => {
		const adapter = createAdapter('postgresql://localhost/test')
		expect(adapter).toBeInstanceOf(PgAdapter)
		expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		expect(adapter.connectionString).toBe('postgresql://localhost/test')
	})

	it('createAdapter passes options through', () => {
		const adapter = createAdapter('postgresql://localhost/test', {
			verbose: true,
			dryRun: true
		})
		expect(adapter.verbose).toBe(true)
		expect(adapter.dryRun).toBe(true)
	})

	it('createAdapter with driver:psql returns PsqlAdapter', () => {
		const adapter = createAdapter('postgresql://localhost/test', { driver: 'psql' })
		expect(adapter).toBeInstanceOf(PsqlAdapter)
	})

	it('createAdapter with driver:pg returns PgAdapter', () => {
		const adapter = createAdapter('postgresql://localhost/test', { driver: 'pg' })
		expect(adapter).toBeInstanceOf(PgAdapter)
	})
})
