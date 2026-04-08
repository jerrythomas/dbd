import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildImportArgs, convexImportCommand, seedTable } from '../src/data-seeder.js'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../src/schema-generator.js', () => ({
	resolveTableName: vi.fn((table) => table.name.split('.').pop())
}))

describe('buildImportArgs', () => {
	it('returns arg array for csv in dev', () => {
		expect(buildImportArgs('users', 'data.csv', 'csv', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'csv',
			'data.csv'
		])
	})

	it('returns arg array with --prod flag', () => {
		expect(buildImportArgs('users', 'data.csv', 'csv', true)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'csv',
			'--prod',
			'data.csv'
		])
	})

	it('maps json format to jsonl', () => {
		expect(buildImportArgs('users', 'data.json', 'json', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'jsonl',
			'data.json'
		])
	})

	it('defaults unknown format to jsonl', () => {
		expect(buildImportArgs('users', 'data.tsv', 'tsv', false)).toEqual([
			'convex',
			'import',
			'--table',
			'users',
			'--format',
			'jsonl',
			'data.tsv'
		])
	})
})

describe('convexImportCommand', () => {
	it('returns a human-readable command string for dry-run display', () => {
		expect(convexImportCommand('users', 'data.csv', 'csv', false)).toBe(
			'npx convex import --table users --format csv data.csv'
		)
	})

	it('includes --prod in command string', () => {
		expect(convexImportCommand('users', 'data.csv', 'csv', true)).toBe(
			'npx convex import --table users --format csv --prod data.csv'
		)
	})
})

describe('seedTable', () => {
	let execFileSyncMock

	beforeEach(async () => {
		const childProcess = await import('child_process')
		execFileSyncMock = childProcess.execFileSync
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('calls execFileSync with npx and correct args for csv table', () => {
		const table = { name: 'public.users', schema: 'public', file: 'data/users.csv', format: 'csv' }
		seedTable(table, {}, false)
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'npx',
			['convex', 'import', '--table', 'users', '--format', 'csv', 'data/users.csv'],
			expect.objectContaining({ stdio: 'inherit' })
		)
	})

	it('includes --prod when isProd is true', () => {
		const table = {
			name: 'public.orders',
			schema: 'public',
			file: 'data/orders.csv',
			format: 'csv'
		}
		seedTable(table, {}, true)
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'npx',
			['convex', 'import', '--table', 'orders', '--format', 'csv', '--prod', 'data/orders.csv'],
			expect.objectContaining({ stdio: 'inherit' })
		)
	})

	it('defaults format to csv when not specified', () => {
		const table = { name: 'public.items', schema: 'public', file: 'data/items.csv' }
		seedTable(table, {}, false)
		expect(execFileSyncMock).toHaveBeenCalledWith(
			'npx',
			['convex', 'import', '--table', 'items', '--format', 'csv', 'data/items.csv'],
			expect.objectContaining({ stdio: 'inherit' })
		)
	})
})
