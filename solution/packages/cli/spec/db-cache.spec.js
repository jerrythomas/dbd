import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DbReferenceCache } from '../src/db-cache.js'
import { resolveWarnings, matchReferences } from '../src/references.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

vi.mock('fs', async () => {
	const actual = await vi.importActual('fs')
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn()
	}
})

// Mock adapter that simulates database catalog queries
function mockAdapter(knownEntities = {}) {
	return {
		async resolveEntity(name, searchPaths) {
			const parts = name.split('.')
			if (parts.length > 1) {
				return knownEntities[name] || null
			}
			for (const schema of searchPaths) {
				const qualified = `${schema}.${name}`
				if (knownEntities[qualified]) return knownEntities[qualified]
			}
			return null
		}
	}
}

describe('DbReferenceCache', () => {
	beforeEach(() => {
		vi.resetAllMocks()
		existsSync.mockReturnValue(false)
	})

	it('resolves entity from adapter on cache miss', async () => {
		const adapter = mockAdapter({
			'public.uuid_generate_v4': {
				name: 'public.uuid_generate_v4',
				schema: 'public',
				type: 'function'
			}
		})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const result = await cache.resolve('uuid_generate_v4', ['public'])
		expect(result).toEqual({
			name: 'public.uuid_generate_v4',
			schema: 'public',
			type: 'function'
		})
	})

	it('returns cached result on second call', async () => {
		const adapter = mockAdapter({
			'public.users': { name: 'public.users', schema: 'public', type: 'table' }
		})
		const spy = vi.spyOn(adapter, 'resolveEntity')
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		await cache.resolve('users', ['public'])
		await cache.resolve('users', ['public'])

		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('caches null for entities not found in database', async () => {
		const adapter = mockAdapter({})
		const spy = vi.spyOn(adapter, 'resolveEntity')
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const result1 = await cache.resolve('nonexistent', ['public'])
		const result2 = await cache.resolve('nonexistent', ['public'])

		expect(result1).toBeNull()
		expect(result2).toBeNull()
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('tracks cache size', async () => {
		const adapter = mockAdapter({
			'public.a': { name: 'public.a', schema: 'public', type: 'table' }
		})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')
		expect(cache.size).toBe(0)

		await cache.resolve('a', ['public'])
		expect(cache.size).toBe(1)

		await cache.resolve('b', ['public'])
		expect(cache.size).toBe(2)
	})

	it('clears cache', async () => {
		const adapter = mockAdapter({
			'public.a': { name: 'public.a', schema: 'public', type: 'table' }
		})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		await cache.resolve('a', ['public'])
		expect(cache.size).toBe(1)

		cache.clear()
		expect(cache.size).toBe(0)
	})

	describe('load()', () => {
		it('loads entities from cache file', () => {
			existsSync.mockReturnValue(true)
			readFileSync.mockReturnValue(
				JSON.stringify({
					entities: {
						'public.users': { name: 'public.users', schema: 'public', type: 'table' }
					}
				})
			)

			const cache = new DbReferenceCache(mockAdapter(), 'postgres://localhost/test')
			cache.load()
			expect(cache.size).toBe(1)
		})

		it('handles missing cache file gracefully', () => {
			existsSync.mockReturnValue(false)

			const cache = new DbReferenceCache(mockAdapter(), 'postgres://localhost/test')
			cache.load()
			expect(cache.size).toBe(0)
		})

		it('handles corrupt cache file gracefully', () => {
			existsSync.mockReturnValue(true)
			readFileSync.mockReturnValue('not json')

			const cache = new DbReferenceCache(mockAdapter(), 'postgres://localhost/test')
			cache.load()
			expect(cache.size).toBe(0)
		})
	})

	describe('save()', () => {
		it('writes cache to disk after resolve', async () => {
			const cache = new DbReferenceCache(
				mockAdapter({ 'public.a': { name: 'public.a', schema: 'public', type: 'table' } }),
				'postgres://localhost/test'
			)
			await cache.resolve('a', ['public'])
			cache.save()

			expect(mkdirSync).toHaveBeenCalled()
			expect(writeFileSync).toHaveBeenCalled()
		})

		it('skips write when cache is not dirty', () => {
			const cache = new DbReferenceCache(mockAdapter(), 'postgres://localhost/test')
			cache.save()
			expect(writeFileSync).not.toHaveBeenCalled()
		})

		it('handles write errors gracefully', async () => {
			writeFileSync.mockImplementation(() => {
				throw new Error('Permission denied')
			})

			const cache = new DbReferenceCache(
				mockAdapter({ 'public.a': { name: 'public.a', schema: 'public', type: 'table' } }),
				'postgres://localhost/test'
			)
			await cache.resolve('a', ['public'])
			// Should not throw
			expect(() => cache.save()).not.toThrow()
		})
	})
})

describe('resolveWarnings()', () => {
	it('returns entities unchanged when dbResolver is null', async () => {
		const entities = [{ name: 'public.a', warnings: ['some warning'] }]
		const result = await resolveWarnings(entities, null)
		expect(result).toBe(entities)
	})

	it('resolves warnings for entities found in database', async () => {
		const adapter = mockAdapter({
			'public.uuid_generate_v4': {
				name: 'public.uuid_generate_v4',
				schema: 'public',
				type: 'function'
			}
		})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const entities = [
			{
				name: 'public.users',
				schema: 'public',
				type: 'table',
				searchPaths: ['public'],
				references: [
					{
						name: 'public.uuid_generate_v4',
						type: null,
						warning: 'Reference public.uuid_generate_v4 not found'
					}
				],
				warnings: ['Reference public.uuid_generate_v4 not found'],
				refers: []
			}
		]

		const result = await resolveWarnings(entities, cache)
		expect(result[0].warnings).toEqual([])
		expect(result[0].references[0].warning).toBeUndefined()
		expect(result[0].references[0].type).toBe('function')
	})

	it('keeps warnings for entities not found in database', async () => {
		const adapter = mockAdapter({})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const entities = [
			{
				name: 'public.users',
				schema: 'public',
				type: 'table',
				searchPaths: ['public'],
				references: [
					{
						name: 'truly_missing',
						type: null,
						warning: 'Reference truly_missing not found in [public]'
					}
				],
				warnings: ['Reference truly_missing not found in [public]'],
				refers: []
			}
		]

		const result = await resolveWarnings(entities, cache)
		expect(result[0].warnings).toHaveLength(1)
		expect(result[0].warnings[0]).toContain('truly_missing')
	})

	it('skips entities with no warnings', async () => {
		const adapter = mockAdapter({})
		const spy = vi.spyOn(adapter, 'resolveEntity')
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const entities = [
			{
				name: 'public.clean',
				schema: 'public',
				type: 'table',
				searchPaths: ['public'],
				references: [{ name: 'public.other', type: 'table' }],
				warnings: [],
				refers: ['public.other']
			}
		]

		const result = await resolveWarnings(entities, cache)
		expect(spy).not.toHaveBeenCalled()
		expect(result[0]).toBe(entities[0])
	})

	it('adds resolved references to refers array', async () => {
		const adapter = mockAdapter({
			'public.lookup_values': {
				name: 'public.lookup_values',
				schema: 'public',
				type: 'table'
			}
		})
		const cache = new DbReferenceCache(adapter, 'postgres://localhost/test')

		const entities = [
			{
				name: 'config.genders',
				schema: 'config',
				type: 'view',
				searchPaths: ['config', 'public'],
				references: [
					{
						name: 'lookup_values',
						type: 'table/view',
						warning: 'Reference lookup_values not found in [config, public]'
					}
				],
				warnings: ['Reference lookup_values not found in [config, public]'],
				refers: []
			}
		]

		const result = await resolveWarnings(entities, cache)
		expect(result[0].refers).toContain('public.lookup_values')
		expect(result[0].warnings).toEqual([])
	})
})
