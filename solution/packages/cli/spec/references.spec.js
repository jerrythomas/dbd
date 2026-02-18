/**
 * Tests for packages/cli/src/references.js
 *
 * Dialect-agnostic reference resolution tests.
 * Postgres-specific tests (isInternal, extractReferences, etc.) are in
 * packages/postgres/spec/adapter-parse.spec.js.
 */
import { describe, it, expect } from 'vitest'
import {
	matchReferences,
	findEntityByName,
	generateLookupTree,
	resolveWarnings
} from '../src/references.js'

/**
 * Mock classifier that simulates adapter.classifyReference().
 * Knows a few builtins and one extension.
 */
function mockClassifier(name, installed = []) {
	const builtins = ['count', 'avg', 'sum', 'now', 'coalesce']
	const extensionFuncs = { 'uuid-ossp': ['uuid_generate_v4'] }
	const lower = name.toLowerCase()

	if (builtins.includes(lower)) return 'internal'
	for (const ext of installed) {
		if (extensionFuncs[ext]?.includes(lower)) return 'extension'
	}
	return null
}

describe('references (dialect-agnostic)', () => {
	describe('generateLookupTree()', () => {
		it('builds name->entity lookup', () => {
			const entities = [
				{ name: 'public.users', schema: 'public', type: 'table', extra: 'ignored' },
				{ name: 'public.orders', schema: 'public', type: 'table' }
			]
			const tree = generateLookupTree(entities)
			expect(tree['public.users']).toEqual({
				name: 'public.users',
				schema: 'public',
				type: 'table'
			})
			expect(tree['public.orders']).toEqual({
				name: 'public.orders',
				schema: 'public',
				type: 'table'
			})
		})
	})

	describe('findEntityByName()', () => {
		const lookup = {
			'public.users': { name: 'public.users', schema: 'public', type: 'table' },
			'config.lookups': { name: 'config.lookups', schema: 'config', type: 'table' }
		}

		it('finds entity by qualified name', () => {
			const result = findEntityByName(
				{ name: 'public.users', type: 'table/view' },
				['public'],
				lookup,
				mockClassifier
			)
			expect(result.name).toBe('public.users')
			expect(result.type).toBe('table')
		})

		it('finds entity by search path', () => {
			const result = findEntityByName(
				{ name: 'lookups', type: 'table/view' },
				['config', 'public'],
				lookup,
				mockClassifier
			)
			expect(result.name).toBe('config.lookups')
		})

		it('returns warning for unresolved qualified name', () => {
			const result = findEntityByName(
				{ name: 'other.missing_table', type: 'table/view' },
				['public'],
				lookup,
				mockClassifier
			)
			expect(result).toHaveProperty('warning')
			expect(result.warning).toContain('not found')
		})

		it('returns warning for unresolved unqualified name', () => {
			const result = findEntityByName(
				{ name: 'nonexistent', type: 'table/view' },
				['public'],
				lookup,
				mockClassifier
			)
			expect(result.warning).toContain('not found')
		})

		it('identifies internal builtins via classifier', () => {
			const result = findEntityByName(
				{ name: 'count', type: 'function' },
				['public'],
				lookup,
				mockClassifier
			)
			expect(result.type).toBe('internal')
		})

		it('identifies extension references via classifier', () => {
			const result = findEntityByName(
				{ name: 'uuid_generate_v4', type: 'function' },
				['public'],
				lookup,
				mockClassifier,
				['uuid-ossp']
			)
			expect(result.type).toBe('extension')
		})

		it('returns warning for unknown references', () => {
			const result = findEntityByName(
				{ name: 'my_custom_func', type: 'function' },
				['public'],
				lookup,
				mockClassifier,
				[]
			)
			expect(result.warning).toContain('not found')
		})
	})

	describe('matchReferences()', () => {
		it('resolves known references', () => {
			const entities = [
				{
					name: 'public.a',
					schema: 'public',
					type: 'table',
					searchPaths: ['public'],
					references: [{ name: 'public.b', type: 'table/view' }]
				},
				{
					name: 'public.b',
					schema: 'public',
					type: 'table',
					searchPaths: ['public'],
					references: []
				}
			]
			const result = matchReferences(entities, [], mockClassifier)
			const a = result.find((e) => e.name === 'public.a')
			expect(a.refers).toContain('public.b')
		})

		it('collects warnings for unresolved references', () => {
			const entities = [
				{
					name: 'public.a',
					schema: 'public',
					type: 'table',
					searchPaths: ['public'],
					references: [{ name: 'missing_table', type: 'table/view' }]
				}
			]
			const result = matchReferences(entities, [], mockClassifier)
			expect(result[0].warnings.length).toBeGreaterThan(0)
		})

		it('classifies internal builtins and excludes from refers', () => {
			const entities = [
				{
					name: 'public.a',
					schema: 'public',
					type: 'table',
					searchPaths: ['public'],
					references: [{ name: 'count', type: 'function' }]
				}
			]
			const result = matchReferences(entities, [], mockClassifier)
			expect(result[0].refers).toEqual([])
			expect(result[0].warnings).toEqual([])
		})
	})

	describe('resolveWarnings()', () => {
		it('returns entities unchanged when no dbResolver', async () => {
			const entities = [{ name: 'a', warnings: ['something'] }]
			const result = await resolveWarnings(entities, null)
			expect(result).toBe(entities)
		})

		it('resolves warnings against db catalog', async () => {
			const entities = [
				{
					name: 'public.a',
					warnings: ['Reference other.foo not found'],
					references: [
						{ name: 'other.foo', type: 'table', warning: 'Reference other.foo not found' }
					]
				}
			]
			const mockResolver = {
				resolve: async (name) => {
					if (name === 'other.foo') return { name: 'other.foo', schema: 'other', type: 'table' }
					return null
				}
			}
			const result = await resolveWarnings(entities, mockResolver)
			expect(result[0].warnings).toEqual([])
			expect(result[0].references[0].name).toBe('other.foo')
			expect(result[0].references[0]).not.toHaveProperty('warning')
		})

		it('keeps warnings when db resolution fails', async () => {
			const entities = [
				{
					name: 'public.a',
					warnings: ['Reference missing not found'],
					references: [{ name: 'missing', type: 'table', warning: 'Reference missing not found' }]
				}
			]
			const mockResolver = {
				resolve: async () => null
			}
			const result = await resolveWarnings(entities, mockResolver)
			expect(result[0].warnings.length).toBe(1)
		})

		it('skips entities without warnings', async () => {
			const entities = [{ name: 'public.a', warnings: [], references: [] }]
			const mockResolver = { resolve: async () => null }
			const result = await resolveWarnings(entities, mockResolver)
			expect(result[0]).toBe(entities[0])
		})
	})
})
