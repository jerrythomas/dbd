import { describe, it, expect } from 'vitest'
import {
	buildDependencyGraph,
	findCycles,
	validateDependencies,
	sortByDependencies,
	groupByDependencyLevel
} from '../src/dependency-resolver.js'

describe('dependency-resolver', () => {
	describe('buildDependencyGraph()', () => {
		it('builds a graph from entities', () => {
			const entities = [
				{ name: 'a', refers: ['b'] },
				{ name: 'b', refers: [] },
				{ name: 'c', refers: ['a', 'b'] }
			]
			const graph = buildDependencyGraph(entities)
			expect(graph.size).toBe(3)
			expect([...graph.get('a')]).toEqual(['b'])
			expect([...graph.get('b')]).toEqual([])
			expect([...graph.get('c')]).toEqual(['a', 'b'])
		})

		it('handles entities with no refers', () => {
			const entities = [{ name: 'x', refers: [] }]
			const graph = buildDependencyGraph(entities)
			expect([...graph.get('x')]).toEqual([])
		})

		it('handles missing refers property', () => {
			const entities = [{ name: 'x' }]
			const graph = buildDependencyGraph(entities)
			expect([...graph.get('x')]).toEqual([])
		})
	})

	describe('findCycles()', () => {
		it('returns empty array for acyclic graph', () => {
			const graph = new Map([
				['a', new Set(['b'])],
				['b', new Set(['c'])],
				['c', new Set()]
			])
			expect(findCycles(graph)).toEqual([])
		})

		it('detects a simple cycle', () => {
			const graph = new Map([
				['a', new Set(['b'])],
				['b', new Set(['a'])]
			])
			const cycles = findCycles(graph)
			expect(cycles.length).toBe(1)
			expect(cycles[0]).toContain('a')
			expect(cycles[0]).toContain('b')
		})

		it('detects cycles in a larger graph', () => {
			const graph = new Map([
				['a', new Set()],
				['b', new Set(['c'])],
				['c', new Set(['d'])],
				['d', new Set(['b'])]
			])
			const cycles = findCycles(graph)
			expect(cycles.length).toBe(1)
			expect(cycles[0]).toContain('b')
			expect(cycles[0]).toContain('c')
			expect(cycles[0]).toContain('d')
		})
	})

	describe('validateDependencies()', () => {
		it('valid for acyclic entities', () => {
			const entities = [
				{ name: 'a', refers: ['b'] },
				{ name: 'b', refers: [] }
			]
			const result = validateDependencies(entities)
			expect(result.isValid).toBe(true)
			expect(result.cycles).toEqual([])
			expect(result.warnings).toEqual([])
		})

		it('reports missing dependencies as warnings', () => {
			const entities = [{ name: 'a', refers: ['b'] }]
			const result = validateDependencies(entities)
			expect(result.isValid).toBe(true)
			expect(result.warnings).toEqual(['Missing dependency: b'])
		})

		it('returns no warnings when all dependencies exist', () => {
			const entities = [
				{ name: 'a', refers: [] },
				{ name: 'b', refers: ['a'] }
			]
			const result = validateDependencies(entities)
			expect(result.isValid).toBe(true)
			expect(result.warnings).toEqual([])
			expect(result.cycles).toEqual([])
		})

		it('reports cycles', () => {
			const entities = [
				{ name: 'a', refers: ['b'] },
				{ name: 'b', refers: ['a'] }
			]
			const result = validateDependencies(entities)
			expect(result.isValid).toBe(false)
			expect(result.cycles.length).toBe(1)
		})
	})

	describe('sortByDependencies()', () => {
		it('sorts entities in dependency order', () => {
			const entities = [
				{ name: 'c', refers: ['a', 'b'] },
				{ name: 'a', refers: [] },
				{ name: 'b', refers: ['a'] }
			]
			const sorted = sortByDependencies(entities)
			const names = sorted.map((e) => e.name)
			expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'))
			expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'))
		})

		it('adds missing dependencies as stubs', () => {
			const entities = [{ name: 'a', refers: ['missing'] }]
			const sorted = sortByDependencies(entities)
			const names = sorted.map((e) => e.name)
			expect(names).toContain('missing')
			expect(names.indexOf('missing')).toBeLessThan(names.indexOf('a'))
		})

		it('marks cyclic entities with errors', () => {
			const entities = [
				{ name: 'a', refers: ['b'] },
				{ name: 'b', refers: ['a'] }
			]
			const sorted = sortByDependencies(entities)
			expect(sorted.every((e) => e.errors.includes('Cyclic dependency found'))).toBe(true)
		})

		it('non-cyclic entities get empty errors', () => {
			const entities = [
				{ name: 'a', refers: [] },
				{ name: 'b', refers: ['a'] }
			]
			const sorted = sortByDependencies(entities)
			expect(sorted.every((e) => e.errors.length === 0)).toBe(true)
		})

		it('handles entities with undefined refers', () => {
			const entities = [{ name: 'a' }, { name: 'b' }]
			const sorted = sortByDependencies(entities)
			const names = sorted.map((e) => e.name)
			expect(names).toContain('a')
			expect(names).toContain('b')
			expect(sorted.every((e) => e.errors.length === 0)).toBe(true)
		})

		it('handles complex dependency chains', () => {
			const entities = [
				{ name: 'public.allocations', refers: ['public.teams', 'public.associates'] },
				{ name: 'public.teams', refers: ['public.clients'] },
				{ name: 'public.associates', refers: ['public.lookup_values'] },
				{ name: 'public.clients', refers: [] },
				{ name: 'public.lookup_values', refers: [] }
			]
			const sorted = sortByDependencies(entities)
			const names = sorted.map((e) => e.name)
			expect(names.indexOf('public.clients')).toBeLessThan(names.indexOf('public.teams'))
			expect(names.indexOf('public.teams')).toBeLessThan(names.indexOf('public.allocations'))
			expect(names.indexOf('public.lookup_values')).toBeLessThan(names.indexOf('public.associates'))
			expect(names.indexOf('public.associates')).toBeLessThan(names.indexOf('public.allocations'))
		})
	})

	describe('groupByDependencyLevel()', () => {
		it('groups into layers', () => {
			const entities = [
				{ name: 'c', refers: ['a', 'b'] },
				{ name: 'a', refers: [] },
				{ name: 'b', refers: ['a'] }
			]
			const groups = groupByDependencyLevel(entities)
			expect(groups.length).toBeGreaterThanOrEqual(2)
			const firstNames = groups[0].map((e) => e.name)
			expect(firstNames).toContain('a')
		})

		it('entities with no deps are in the first group', () => {
			const entities = [
				{ name: 'a', refers: [] },
				{ name: 'b', refers: [] },
				{ name: 'c', refers: ['a'] }
			]
			const groups = groupByDependencyLevel(entities)
			const firstNames = groups[0].map((e) => e.name)
			expect(firstNames).toContain('a')
			expect(firstNames).toContain('b')
		})
	})
})
