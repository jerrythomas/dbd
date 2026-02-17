import { describe, it, expect } from 'vitest'
import { createAdapter, PsqlAdapter } from '../src/index.js'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

describe('adapter factory', () => {
	it('exports PsqlAdapter', () => {
		expect(PsqlAdapter).toBeDefined()
		expect(PsqlAdapter.prototype).toBeInstanceOf(BaseDatabaseAdapter)
	})

	it('createAdapter returns a PsqlAdapter instance', () => {
		const adapter = createAdapter('postgresql://localhost/test')
		expect(adapter).toBeInstanceOf(PsqlAdapter)
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
})
