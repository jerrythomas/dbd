/**
 * Tests for packages/cli/src/references.js
 *
 * Mirrors spec/compat/references.spec.js but imports from the new package.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
	isInternal,
	isAnsiiSQL,
	isPostgres,
	isExtension,
	resetCache,
	extractReferences,
	extractTableReferences,
	extractTriggerReferences,
	extractSearchPaths,
	extractWithAliases,
	removeCommentBlocks,
	removeIndexCreationStatements,
	normalizeComment,
	cleanupDDLForDBML,
	matchReferences,
	parseEntityScript,
	generateLookupTree
} from '../src/references.js'
import fs from 'fs'

describe('references', () => {
	beforeEach(() => {
		resetCache()
	})

	describe('isInternal()', () => {
		it('recognizes ANSI SQL functions', () => {
			expect(isAnsiiSQL('count')).toBe('internal')
			expect(isAnsiiSQL('avg')).toBe('internal')
			expect(isAnsiiSQL('sum')).toBe('internal')
		})

		it('recognizes PostgreSQL functions', () => {
			expect(isPostgres('now')).toBe('internal')
			expect(isPostgres('unnest')).toBe('internal')
		})

		it('recognizes PostgreSQL pattern-matched functions', () => {
			expect(isPostgres('pg_catalog')).toBe('internal')
			expect(isPostgres('array_agg')).toBe('internal')
			expect(isPostgres('to_char')).toBe('internal')
		})

		it('recognizes extension functions', () => {
			expect(isExtension('uuid_generate_v4', ['uuid-ossp'])).toBe('extension')
			expect(isExtension('gen_salt', ['pgcrypto'])).toBe('extension')
		})

		it('returns null for unknown functions', () => {
			expect(isInternal('my_custom_function')).toBeNull()
		})

		it('caches results', () => {
			isInternal('count')
			isInternal('count')
			// Should not error — cache should handle this
			expect(isInternal('count')).toBe('internal')
		})
	})

	describe('extractSearchPaths()', () => {
		it('returns default public when no SET search_path', () => {
			expect(extractSearchPaths('SELECT 1;')).toEqual(['public'])
		})

		it('extracts single search path', () => {
			expect(extractSearchPaths('SET search_path to staging;')).toEqual(['staging'])
		})

		it('extracts multiple search paths', () => {
			expect(extractSearchPaths('SET search_path to staging, public;')).toEqual([
				'staging',
				'public'
			])
		})

		it('last SET wins', () => {
			const sql = 'SET search_path to staging;\nSET search_path to config;'
			expect(extractSearchPaths(sql)).toEqual(['config'])
		})
	})

	describe('extractWithAliases()', () => {
		it('extracts CTE aliases', () => {
			const sql = 'WITH foo AS (SELECT 1), bar AS (SELECT 2) SELECT * FROM foo;'
			const aliases = extractWithAliases(sql)
			expect(aliases).toContain('foo')
			expect(aliases).toContain('bar')
		})

		it('extracts recursive CTE aliases', () => {
			const sql = 'WITH RECURSIVE tree AS (SELECT 1) SELECT * FROM tree;'
			const aliases = extractWithAliases(sql)
			expect(aliases).toContain('tree')
		})
	})

	describe('removeCommentBlocks()', () => {
		it('removes COMMENT ON statements', () => {
			const sql = "COMMENT ON TABLE foo IS 'some comment';\nSELECT 1;"
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain("IS 'some comment'")
			expect(result).toContain('SELECT 1;')
		})

		it('removes line comments', () => {
			const sql = '-- this is a comment\nSELECT 1;'
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('this is a comment')
		})

		it('removes block comments', () => {
			const sql = '/* block comment */ SELECT 1;'
			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('block comment')
		})
	})

	describe('removeIndexCreationStatements()', () => {
		it('removes CREATE INDEX statements', () => {
			const sql = 'CREATE TABLE foo (id int);\nCREATE INDEX idx_foo ON foo(id);'
			const result = removeIndexCreationStatements(sql)
			expect(result).toContain('CREATE TABLE foo')
			expect(result).not.toContain('CREATE INDEX')
		})
	})

	describe('normalizeComment()', () => {
		it('collapses multiline comments to single line', () => {
			const input = "comment on table foo IS 'line1\nline2';"
			const result = normalizeComment(input)
			expect(result).not.toContain('\n')
			expect(result).toContain('line1')
			expect(result).toContain('line2')
		})
	})

	describe('cleanupDDLForDBML()', () => {
		it('removes index statements', () => {
			const sql = 'CREATE TABLE foo (id int);\nCREATE INDEX idx ON foo(id);'
			const result = cleanupDDLForDBML(sql)
			expect(result).not.toContain('CREATE INDEX')
		})

		it('returns falsy input as-is', () => {
			expect(cleanupDDLForDBML(null)).toBeNull()
			expect(cleanupDDLForDBML('')).toBe('')
		})
	})

	describe('generateLookupTree()', () => {
		it('builds name→entity lookup', () => {
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
			const result = matchReferences(entities)
			const a = result.find((e) => e.name === 'public.a')
			expect(a.refers).toContain('public.b')
		})
	})
})
