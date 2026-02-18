/**
 * Tests for packages/cli/src/references.js
 *
 * Mirrors spec/compat/references.spec.js but imports from the new package.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
	extractEntity,
	removeCommentBlocks,
	removeIndexCreationStatements,
	normalizeComment,
	cleanupDDLForDBML,
	matchReferences,
	findEntityByName,
	parseEntityScript,
	generateLookupTree,
	matchesKnownExtension
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

	describe('extractEntity()', () => {
		it('extracts CREATE TABLE entity', () => {
			const result = extractEntity('CREATE TABLE config.lookups (id int);')
			expect(result.type).toBe('table')
			expect(result.name).toBe('lookups')
			expect(result.schema).toBe('config')
		})

		it('extracts CREATE VIEW entity', () => {
			const result = extractEntity('CREATE OR REPLACE VIEW staging.active AS SELECT 1;')
			expect(result.type).toBe('view')
			expect(result.name).toBe('active')
		})

		it('extracts CREATE FUNCTION entity', () => {
			const result = extractEntity(
				'CREATE FUNCTION staging.do_stuff() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;'
			)
			expect(result.type).toBe('function')
			expect(result.name).toBe('do_stuff')
		})

		it('returns undefined for non-DDL', () => {
			const result = extractEntity('SELECT 1;')
			expect(result.name).toBeUndefined()
		})
	})

	describe('extractReferences()', () => {
		it('extracts function call references', () => {
			const sql = `PERFORM staging.import_lookups('config');`
			const refs = extractReferences(sql)
			const names = refs.map((r) => r.name)
			expect(names).toContain('staging.import_lookups')
		})

		it('excludes internal functions', () => {
			const sql = `SELECT count(*), now();`
			const refs = extractReferences(sql)
			const names = refs.map((r) => r.name)
			expect(names).not.toContain('count')
			expect(names).not.toContain('now')
		})

		it('returns empty for SQL without function calls', () => {
			const refs = extractReferences('SELECT 1;')
			expect(refs).toEqual([])
		})
	})

	describe('extractTableReferences()', () => {
		it('extracts FROM clause table references', () => {
			const sql = 'SELECT * FROM staging.data;'
			const refs = extractTableReferences(sql)
			const names = refs.map((r) => r.name)
			expect(names).toContain('staging.data')
		})

		it('excludes CTE aliases', () => {
			const sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte;'
			const refs = extractTableReferences(sql)
			const names = refs.map((r) => r.name)
			expect(names).not.toContain('cte')
		})
	})

	describe('extractTriggerReferences()', () => {
		it('extracts trigger table references', () => {
			const sql = `CREATE TRIGGER trg_audit
				AFTER INSERT ON config.lookups
				FOR EACH ROW EXECUTE FUNCTION audit_fn();`
			const refs = extractTriggerReferences(sql)
			const names = refs.map((r) => r.name)
			expect(names).toContain('config.lookups')
		})

		it('returns empty for non-trigger SQL', () => {
			const refs = extractTriggerReferences('SELECT 1;')
			expect(refs).toEqual([])
		})
	})

	describe('matchesKnownExtension()', () => {
		it('matches uuid-ossp pattern', () => {
			expect(matchesKnownExtension('uuid_generate_v4')).toBe('uuid-ossp')
		})

		it('matches pgmq pattern', () => {
			expect(matchesKnownExtension('pgmq_send')).toBe('pgmq')
		})

		it('returns null for unknown', () => {
			expect(matchesKnownExtension('my_custom_func')).toBeNull()
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
				lookup
			)
			expect(result.name).toBe('public.users')
			expect(result.type).toBe('table')
		})

		it('finds entity by search path', () => {
			const result = findEntityByName(
				{ name: 'lookups', type: 'table/view' },
				['config', 'public'],
				lookup
			)
			expect(result.name).toBe('config.lookups')
		})

		it('returns warning for unresolved qualified name', () => {
			const result = findEntityByName(
				{ name: 'other.missing_table', type: 'table/view' },
				['public'],
				lookup
			)
			expect(result).toHaveProperty('warning')
			expect(result.warning).toContain('not found')
		})

		it('returns warning for unresolved unqualified name', () => {
			const result = findEntityByName(
				{ name: 'nonexistent', type: 'table/view' },
				['public'],
				lookup
			)
			expect(result.warning).toContain('not found')
		})

		it('identifies extension references', () => {
			const result = findEntityByName(
				{ name: 'uuid_generate_v4', type: 'function' },
				['public'],
				lookup,
				['uuid-ossp']
			)
			expect(result.type).toBe('extension')
		})

		it('warns about undeclared extensions', () => {
			const result = findEntityByName(
				{ name: 'uuid_generate_v4', type: 'function' },
				['public'],
				lookup,
				[]
			)
			expect(result.warning).toContain('undeclared extension')
		})
	})

	describe('parseEntityScript()', () => {
		it('parses entity from DDL file', () => {
			vi.spyOn(fs, 'readFileSync').mockReturnValue(
				'SET search_path to config;\nCREATE TABLE config.lookups (id int);'
			)
			const entity = {
				name: 'config.lookups',
				schema: 'config',
				type: 'table',
				file: 'ddl/table/config/lookups.ddl'
			}
			const result = parseEntityScript(entity)
			expect(result.name).toBe('config.lookups')
			expect(result.schema).toBe('config')
			expect(result.searchPaths).toBeDefined()
			vi.restoreAllMocks()
		})

		it('reports schema mismatch errors', () => {
			vi.spyOn(fs, 'readFileSync').mockReturnValue(
				'SET search_path to wrong;\nCREATE TABLE wrong.lookups (id int);'
			)
			const entity = {
				name: 'config.lookups',
				schema: 'config',
				type: 'table',
				file: 'ddl/table/config/lookups.ddl'
			}
			const result = parseEntityScript(entity)
			expect(result.errors.some((e) => e.includes('Schema'))).toBe(true)
			vi.restoreAllMocks()
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
			const result = matchReferences(entities)
			expect(result[0].warnings.length).toBeGreaterThan(0)
		})
	})
})
