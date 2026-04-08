import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdirSync } from 'fs'
import { ConvexAdapter } from '../src/convex-adapter.js'
import { BaseDatabaseAdapter } from '@jerrythomas/dbd-db'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		existsSync: vi.fn(() => false)
	}
})

import { writeFileSync } from 'fs'
import { execFileSync } from 'child_process'

const makeTable = (schema, name, columns = []) => ({
	type: 'table',
	name: `${schema}.${name}`,
	schema,
	columns,
	errors: [],
	warnings: []
})

describe('ConvexAdapter', () => {
	let adapter

	beforeEach(() => {
		vi.clearAllMocks()
		adapter = new ConvexAdapter('', { convex: {}, env: 'prod' })
	})

	describe('inheritance', () => {
		it('extends BaseDatabaseAdapter', () => {
			expect(adapter).toBeInstanceOf(BaseDatabaseAdapter)
		})
	})

	describe('prefersBatchApply()', () => {
		it('returns true', () => {
			expect(adapter.prefersBatchApply()).toBe(true)
		})
	})

	describe('no-op operations', () => {
		it('connect() resolves', async () => {
			await expect(adapter.connect()).resolves.toBeUndefined()
		})

		it('disconnect() resolves', async () => {
			await expect(adapter.disconnect()).resolves.toBeUndefined()
		})

		it('executeScript() resolves', async () => {
			await expect(adapter.executeScript('SELECT 1')).resolves.toBeUndefined()
		})

		it('applyEntity() resolves', async () => {
			await expect(
				adapter.applyEntity({ type: 'table', name: 'public.t' })
			).resolves.toBeUndefined()
		})
	})

	describe('parseEntityScript()', () => {
		it('returns entity with empty searchPaths, references, and no errors', () => {
			const entity = { type: 'table', name: 'public.users', file: 'users.ddl', schema: 'public' }
			const result = adapter.parseEntityScript(entity)
			expect(result).toMatchObject({ ...entity, searchPaths: [], references: [], errors: [] })
		})
	})

	describe('applyEntities() — dry-run', () => {
		it('prints schema.ts content to console.info without writing file', async () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
			const dryAdapter = new ConvexAdapter('', { convex: {}, env: 'prod', dryRun: true })
			const entities = [makeTable('public', 'users')]

			await dryAdapter.applyEntities(entities)

			const output = spy.mock.calls.map((c) => c[0]).join('\n')
			expect(output).toContain('export default defineSchema(')
			expect(writeFileSync).not.toHaveBeenCalled()
			spy.mockRestore()
		})
	})

	describe('applyEntities() — non-dry-run', () => {
		it('writes convex/schema.ts', async () => {
			const entities = [makeTable('public', 'users')]
			await adapter.applyEntities(entities)
			expect(mkdirSync).toHaveBeenCalledWith('convex', { recursive: true })
			expect(writeFileSync).toHaveBeenCalledWith(
				'convex/schema.ts',
				expect.stringContaining('export default defineSchema(')
			)
		})

		it('emits warnings from generateSchemaTs', async () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
			const entities = [
				makeTable('public', 'orders'),
				makeTable('staging', 'orders') // collision
			]
			await adapter.applyEntities(entities)
			const warned = spy.mock.calls.map((c) => c[0]).join('\n')
			expect(warned).toContain('collision')
			spy.mockRestore()
		})

		it('skips deploy when CONVEX_URL or CONVEX_DEPLOY_KEY not set', async () => {
			delete process.env.CONVEX_URL
			delete process.env.CONVEX_DEPLOY_KEY
			await adapter.applyEntities([makeTable('public', 'users')])
			expect(execFileSync).not.toHaveBeenCalled()
		})

		it('deploys when both CONVEX_URL and CONVEX_DEPLOY_KEY are set', async () => {
			process.env.CONVEX_URL = 'https://test.convex.cloud'
			process.env.CONVEX_DEPLOY_KEY = 'test-key'
			await adapter.applyEntities([makeTable('public', 'users')])
			expect(execFileSync).toHaveBeenCalledWith(
				'npx',
				['convex', 'deploy'],
				expect.objectContaining({ stdio: 'inherit' })
			)
			delete process.env.CONVEX_URL
			delete process.env.CONVEX_DEPLOY_KEY
		})
	})

	describe('importData()', () => {
		it('calls seedTable for a valid entity', async () => {
			const entity = { name: 'public.users', file: 'data/users.csv', format: 'csv', errors: [] }
			await adapter.importData(entity)
			expect(execFileSync).toHaveBeenCalledWith(
				'npx',
				expect.arrayContaining(['convex', 'import', '--table', 'users']),
				expect.any(Object)
			)
		})

		it('skips entities with errors', async () => {
			const entity = { name: 'bad', errors: ['missing file'] }
			await adapter.importData(entity)
			expect(execFileSync).not.toHaveBeenCalled()
		})

		it('dry-run logs npx convex import command without executing', async () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
			const dryAdapter = new ConvexAdapter('', { convex: {}, env: 'prod', dryRun: true })
			const entity = { name: 'public.users', file: 'data/users.csv', format: 'csv', errors: [] }
			await dryAdapter.importData(entity)
			const output = spy.mock.calls.map((c) => c[0]).join('\n')
			expect(output).toContain('npx convex import')
			expect(output).toContain('users')
			expect(execFileSync).not.toHaveBeenCalled()
			spy.mockRestore()
		})

		it('passes --prod flag when env is prod', async () => {
			const entity = { name: 'public.users', file: 'data/users.csv', format: 'csv', errors: [] }
			await adapter.importData(entity)
			expect(execFileSync).toHaveBeenCalledWith(
				'npx',
				expect.arrayContaining(['--prod']),
				expect.any(Object)
			)
		})

		it('omits --prod flag when env is dev', async () => {
			const devAdapter = new ConvexAdapter('', { convex: {}, env: 'dev' })
			const entity = { name: 'public.users', file: 'data/users.csv', format: 'csv', errors: [] }
			await devAdapter.importData(entity)
			const args = execFileSync.mock.calls[0][1]
			expect(args).not.toContain('--prod')
		})
	})
})
