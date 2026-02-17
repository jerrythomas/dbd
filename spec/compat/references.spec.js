/**
 * Compatibility test suite for reference extraction (src/parser.js).
 *
 * Snapshots the legacy reference extractor's behavior with known SQL inputs.
 * These tests use the spec/fixtures/references/ project as input.
 *
 * Every subsequent migration batch must keep these tests green.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import { extname } from 'path'
import { resetCache } from '../../src/exclusions.js'
import { entityFromFile } from '../../src/entity.js'
import { scan } from '../../src/metadata.js'
import {
	extractReferences,
	extractTableReferences,
	extractTriggerReferences,
	extractSearchPaths,
	extractWithAliases,
	extractEntity,
	parseEntityScript,
	matchReferences,
	generateLookupTree,
	removeIndexCreationStatements,
	cleanupDDLForDBML,
	removeCommentBlocks,
	normalizeComment
} from '../../src/parser.js'
import expectedReferences from '../fixtures/references/references.json'
import expectedExclusions from '../fixtures/references/exclusions.json'

describe('Reference extraction compatibility', () => {
	let originalPath

	beforeAll(() => {
		originalPath = process.cwd()
		process.chdir('spec/fixtures/references')
	})

	afterAll(() => {
		process.chdir(originalPath)
	})

	beforeEach(() => {
		resetCache()
	})

	// --- extractReferences snapshots ---

	describe('extractReferences()', () => {
		it('finds function calls in procedure SQL (import_json_to_table)', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_json_to_table.ddl', 'utf8')
			const refs = extractReferences(content)

			// Should find import_jsonb_to_table procedure reference
			expect(refs).toContainEqual({ name: 'import_jsonb_to_table', type: 'procedure' })
		})

		it('finds function calls in table SQL (lookup_values)', () => {
			const content = fs.readFileSync('ddl/table/config/lookup_values.ddl', 'utf8')
			const refs = extractReferences(content)

			expect(refs).toEqual([
				{ name: 'lookup_values', type: 'table/view' },
				{ name: 'uuid_generate_v4', type: null },
				{ name: 'lookups', type: 'table/view' }
			])
		})

		it('excludes CTE aliases from references', () => {
			const sql = `
				with recursive cte_items as (
					select * from base_items
				),
				filtered as (
					select * from cte_items where active = true
				)
				select * from filtered;
			`
			const refs = extractReferences(sql)

			// CTE aliases should not appear
			expect(refs.some((r) => r.name === 'cte_items')).toBe(false)
			expect(refs.some((r) => r.name === 'filtered')).toBe(false)
		})

		it('excludes SQL expressions (coalesce, sum, etc.)', () => {
			const sql = `
				SELECT coalesce(value, 0), sum(amount), count(*)
				FROM payments
				WHERE extract(month from date) = 1;
			`
			const refs = extractReferences(sql)

			expect(refs.some((r) => r.name === 'coalesce')).toBe(false)
			expect(refs.some((r) => r.name === 'sum')).toBe(false)
			expect(refs.some((r) => r.name === 'count')).toBe(false)
			expect(refs.some((r) => r.name === 'extract')).toBe(false)
		})

		it('excludes index references', () => {
			const sql = `
				, PRIMARY KEY (id)
				, UNIQUE INDEX xyz_ukey (name ASC) VISIBLE
				, INDEX fk_reason_type_id (reason_type_id ASC) VISIBLE
				, CONSTRAINT fk_reason_type_id FOREIGN KEY (reason_type_id) REFERENCES dayamed.reason_type (id)
			`
			const refs = extractReferences(sql)
			expect(refs).toEqual([{ name: 'dayamed.reason_type', type: 'table/view' }])
		})
	})

	// --- extractTableReferences snapshots ---

	describe('extractTableReferences()', () => {
		it('finds FROM/JOIN targets in view SQL (genders)', () => {
			const content = fs.readFileSync('ddl/view/config/genders.ddl', 'utf8')
			const refs = extractTableReferences(content)

			expect(refs).toEqual([
				{ name: 'lookups', type: 'table/view' },
				{ name: 'lookup_values', type: 'table/view' }
			])
		})

		it('finds schema-qualified table references in procedure SQL', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_lookups.ddl', 'utf8')
			const refs = extractTableReferences(content)

			expect(refs).toEqual([
				{ name: 'staging.lookup_values', type: 'table/view' },
				{ name: 'config.lookups', type: 'table/view' },
				{ name: 'config.lookup_values', type: 'table/view' }
			])
		})

		it('excludes internal tables (import_json_to_table procedure)', () => {
			const content = fs.readFileSync('ddl/procedure/staging/import_json_to_table.ddl', 'utf8')
			const refs = extractTableReferences(content)
			expect(refs).toEqual([])
		})

		it('does not treat extract(epoch from duration) as table reference', () => {
			const sql = `
				CREATE VIEW duration_view AS
				SELECT id, avg(extract(epoch from duration)) as avg_duration
				FROM events;
			`
			const refs = extractTableReferences(sql)
			expect(refs).toEqual([{ name: 'events', type: 'table/view' }])
		})
	})

	// --- extractTriggerReferences snapshots ---

	describe('extractTriggerReferences()', () => {
		it('extracts ON table_name from trigger SQL', () => {
			const sql = `
				create trigger add_partitions_trigger
				after insert on core.tenants
				for each row execute function add_partitions();
			`
			const refs = extractTriggerReferences(sql)
			expect(refs).toEqual([{ name: 'core.tenants', type: 'table' }])
		})

		it('handles DROP + CREATE trigger', () => {
			const sql = `
				drop trigger if exists my_trigger on core.tenants;
				create trigger my_trigger
				after insert on core.tenants
				for each row execute function do_something();
			`
			const refs = extractTriggerReferences(sql)
			expect(refs).toEqual([{ name: 'core.tenants', type: 'table' }])
		})
	})

	// --- extractSearchPaths snapshots ---

	describe('extractSearchPaths()', () => {
		it('returns [public] for empty input', () => {
			expect(extractSearchPaths('')).toEqual(['public'])
		})

		it('extracts single search path', () => {
			expect(extractSearchPaths('set search_path to staging;')).toEqual(['staging'])
		})

		it('extracts multiple search paths', () => {
			expect(extractSearchPaths('set search_path to history, extensions;')).toEqual([
				'history',
				'extensions'
			])
		})

		it('uses last search_path when multiple are set', () => {
			const sql = `set search_path to staging;\nset search_path to config, extensions;`
			expect(extractSearchPaths(sql)).toEqual(['config', 'extensions'])
		})
	})

	// --- extractWithAliases snapshots ---

	describe('extractWithAliases()', () => {
		it('extracts recursive CTE aliases', () => {
			const sql = 'with recursive cte as (select * from table1) select * from cte;'
			expect(extractWithAliases(sql)).toEqual(['cte'])
		})

		it('extracts multiple CTE aliases', () => {
			const sql = `
				with org_quotas as (select * from quotas),
				user_data as (select * from users)
				select * from org_quotas join user_data on true
			`
			const aliases = extractWithAliases(sql)
			expect(aliases).toContain('org_quotas')
			expect(aliases).toContain('user_data')
			expect(aliases).toHaveLength(2)
		})
	})

	// --- parseEntityScript snapshots ---

	describe('parseEntityScript()', () => {
		it('parses procedure and detects name mismatch', () => {
			const entity = {
				name: 'staging.import_json_to_table',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_json_to_table.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result.name).toBe('staging.import_jsonb_to_table')
			expect(result.errors).toContain('Entity name in script does not match file name')
		})

		it('parses procedure with references', () => {
			const entity = {
				name: 'staging.import_lookups',
				type: 'procedure',
				schema: 'staging',
				file: 'ddl/procedure/staging/import_lookups.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result.name).toBe('staging.import_lookups')
			expect(result.searchPaths).toEqual(['staging'])
			expect(result.references).toEqual([
				{ name: 'config.lookups', type: 'table/view' },
				{ name: 'config.lookup_values', type: 'table/view' },
				{ name: 'staging.lookup_values', type: 'table/view' }
			])
			expect(result.errors).toEqual([])
		})

		it('parses table with references', () => {
			const entity = {
				name: 'config.lookup_values',
				type: 'table',
				schema: 'config',
				file: 'ddl/table/config/lookup_values.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result.searchPaths).toEqual(['config', 'extensions'])
			expect(result.references).toEqual([
				{ name: 'uuid_generate_v4', type: null },
				{ name: 'lookups', type: 'table/view' }
			])
			expect(result.errors).toEqual([])
		})

		it('parses view with references', () => {
			const entity = {
				name: 'config.genders',
				type: 'view',
				schema: 'config',
				file: 'ddl/view/config/genders.ddl'
			}
			const result = parseEntityScript(entity)

			expect(result.searchPaths).toEqual(['config'])
			expect(result.references).toEqual([
				{ name: 'lookups', type: 'table/view' },
				{ name: 'lookup_values', type: 'table/view' }
			])
			expect(result.errors).toEqual([])
		})
	})

	// --- matchReferences snapshot ---

	describe('matchReferences()', () => {
		let entities

		beforeAll(() => {
			if (process.cwd() !== originalPath + '/spec/fixtures/references') {
				process.chdir(originalPath + '/spec/fixtures/references')
			}
			entities = scan('ddl')
				.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
				.map((file) => entityFromFile(file))
				.map((entity) => parseEntityScript(entity))
		})

		it('resolves all references without extensions', () => {
			resetCache()
			const result = matchReferences(entities).sort((a, b) => a.name.localeCompare(b.name))
			const expected = [...expectedReferences].sort((a, b) => a.name.localeCompare(b.name))

			for (let i = 0; i < result.length; i++) {
				expect(result[i]).toEqual(expected[i])
			}
		})

		it('identifies installed extension entities (uuid-ossp)', () => {
			resetCache()
			const result = matchReferences(entities, ['uuid-ossp']).sort((a, b) =>
				a.name.localeCompare(b.name)
			)
			const expected = [...expectedExclusions].sort((a, b) => a.name.localeCompare(b.name))

			for (let i = 0; i < result.length; i++) {
				expect(result[i]).toEqual(expected[i])
			}
		})
	})

	// --- generateLookupTree snapshot ---

	describe('generateLookupTree()', () => {
		it('builds lookup from scanned entities', () => {
			const entities = scan('ddl')
				.filter((file) => ['.ddl', '.sql'].includes(extname(file)))
				.map((file) => entityFromFile(file))

			const tree = generateLookupTree(entities)

			expect(tree['config.lookups']).toEqual({
				name: 'config.lookups',
				schema: 'config',
				type: 'table'
			})
			expect(tree['config.genders']).toEqual({
				name: 'config.genders',
				schema: 'config',
				type: 'view'
			})
			expect(tree['staging.import_lookups']).toEqual({
				name: 'staging.import_lookups',
				schema: 'staging',
				type: 'procedure'
			})
		})
	})

	// --- DDL cleanup for DBML ---

	describe('removeIndexCreationStatements()', () => {
		it('removes CREATE INDEX statements', () => {
			const ddl = `create table a(id serial);\ncreate unique index if not exists a_ukey\non a (id);\n\ncomment on table a is 'test';`
			const result = removeIndexCreationStatements(ddl)
			expect(result).not.toContain('index')
			expect(result).toContain('create table a')
			expect(result).toContain('comment on table a')
		})

		it('removes function-based indexes', () => {
			const ddl = [
				'some statements before',
				'create unique index if not exists org_ukey',
				'on organizations (lower(name));',
				'some statements after'
			].join('\n')

			const result = removeIndexCreationStatements(ddl)
			expect(result).not.toContain('index')
			expect(result).toContain('some statements before')
			expect(result).toContain('some statements after')
		})
	})

	describe('cleanupDDLForDBML()', () => {
		it('strips index statements for DBML conversion', () => {
			const ddl = `create table t(id int);\ncreate index idx on t(id);`
			const result = cleanupDDLForDBML(ddl)
			expect(result).not.toContain('create index')
		})
	})

	describe('removeCommentBlocks()', () => {
		it('removes COMMENT ON, line comments, and block comments', () => {
			const sql = `create table test (id int);
				comment on table test is 'description (with parens)';
				-- line comment (also parens)
				/* block comment (parens) */
				select * from test;`

			const result = removeCommentBlocks(sql)
			expect(result).not.toContain('description')
			expect(result).not.toContain('line comment')
			expect(result).not.toContain('block comment')
			expect(result).toContain('create table test')
			expect(result).toContain('select * from test')
		})
	})

	describe('normalizeComment()', () => {
		it('collapses multi-line COMMENT ON into single line', () => {
			const input = [
				'Some text.',
				'',
				'comment on table xyz IS',
				"'User roles.\n",
				'- Each role has a name.',
				"- Roles are not tenant specific.';",
				'',
				'More text.'
			].join('\n')

			const result = normalizeComment(input)
			// Should be a single line containing the comment
			expect(result).toContain("comment on table xyz IS 'User roles.")
			expect(result).toContain('Some text.')
			expect(result).toContain('More text.')
		})
	})
})
