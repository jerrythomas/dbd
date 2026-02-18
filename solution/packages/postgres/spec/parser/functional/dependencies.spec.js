import { describe, it, expect } from 'vitest'
import {
	extractDependencies,
	identifyEntity,
	collectReferences
} from '../../../src/parser/index-functional.js'

describe('Dependency Extraction', () => {
	describe('identifyEntity()', () => {
		it('identifies procedure with string procInfo (non-object)', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'procedure',
					procedure: 'my_proc'
				}
			]
			const result = identifyEntity(ast, '')
			expect(result.name).toBe('my_proc')
			expect(result.type).toBe('procedure')
		})

		it('falls back to regex for CREATE FUNCTION in raw SQL', () => {
			// AST has no CREATE statement but raw SQL does
			const ast = [{ type: 'set' }]
			const sql = 'CREATE OR REPLACE FUNCTION staging.do_import() RETURNS void AS $$ BEGIN END; $$'
			const result = identifyEntity(ast, sql)
			expect(result).toEqual({ name: 'do_import', schema: 'staging', type: 'function' })
		})

		it('falls back to regex for CREATE PROCEDURE in raw SQL', () => {
			const ast = [{ type: 'set' }]
			const sql = 'CREATE OR REPLACE PROCEDURE my_proc() LANGUAGE plpgsql AS $$ BEGIN END; $$'
			const result = identifyEntity(ast, sql)
			expect(result).toEqual({ name: 'my_proc', schema: null, type: 'procedure' })
		})

		it('identifies a CREATE TABLE entity', () => {
			const sql = 'SET search_path to config;\nCREATE TABLE lookups (id uuid PRIMARY KEY);'
			const { entity } = extractDependencies(sql)
			expect(entity).toEqual({ name: 'lookups', schema: null, type: 'table' })
		})

		it('identifies a CREATE VIEW entity', () => {
			const sql = `
				SET search_path to config;
				CREATE OR REPLACE VIEW genders AS
				SELECT id, value FROM lookup_values;
			`
			const { entity } = extractDependencies(sql)
			expect(entity).toEqual({ name: 'genders', schema: null, type: 'view' })
		})

		it('identifies a CREATE PROCEDURE entity via regex fallback', () => {
			const sql = `
				SET search_path to staging;
				CREATE OR REPLACE PROCEDURE import_lookups()
				LANGUAGE plpgsql AS $$ BEGIN SELECT 1; END; $$
			`
			const { entity } = extractDependencies(sql)
			expect(entity).toBeDefined()
			expect(entity.name).toBe('import_lookups')
			expect(entity.type).toBe('procedure')
		})

		it('identifies a CREATE FUNCTION entity via regex fallback', () => {
			const sql = `
				SET search_path to runtime;
				CREATE OR REPLACE FUNCTION log_info(p_message text)
				RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$
			`
			const { entity } = extractDependencies(sql)
			expect(entity).toBeDefined()
			expect(entity.name).toBe('log_info')
			expect(entity.type).toBe('function')
		})

		it('returns null for non-CREATE SQL', () => {
			const sql = 'SELECT 1;'
			const { entity } = extractDependencies(sql)
			expect(entity).toBeNull()
		})
	})

	describe('extractDependencies() — searchPaths', () => {
		it('extracts single search_path', () => {
			const sql = 'SET search_path to staging;\nCREATE TABLE t (id int);'
			const { searchPaths } = extractDependencies(sql)
			expect(searchPaths).toContain('staging')
		})

		it('extracts multiple search_paths', () => {
			const sql = 'SET search_path to core, config;\nCREATE TABLE t (id int);'
			const { searchPaths } = extractDependencies(sql)
			expect(searchPaths).toContain('core')
			expect(searchPaths).toContain('config')
		})

		it('defaults to [public] when no search_path', () => {
			const sql = 'CREATE TABLE t (id int);'
			const { searchPaths } = extractDependencies(sql)
			expect(searchPaths).toEqual(['public'])
		})
	})

	describe('extractDependencies() — table FK references', () => {
		it('extracts FK references from CREATE TABLE', () => {
			const sql = `
				SET search_path to core, config;
				CREATE TABLE IF NOT EXISTS users (
					id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
					role_id uuid REFERENCES lookup_values(id),
					created_at timestamp NOT NULL DEFAULT now()
				);
			`
			const { references } = extractDependencies(sql)
			const tableRefs = references.filter((r) => r.type === 'table')
			expect(tableRefs.some((r) => r.name === 'lookup_values')).toBe(true)
		})

		it('does not include SQL keywords or function names as references', () => {
			const sql = `
				SET search_path to core;
				CREATE TABLE users (
					id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
					name varchar NOT NULL,
					created_at timestamp DEFAULT now()
				);
			`
			const { references } = extractDependencies(sql)
			const refNames = references.map((r) => r.name)
			// AST should NOT pick up uuid_generate_v4, now, varchar etc.
			expect(refNames).not.toContain('uuid_generate_v4')
			expect(refNames).not.toContain('now')
			expect(refNames).not.toContain('varchar')
		})
	})

	describe('extractDependencies() — view references', () => {
		it('extracts FROM/JOIN table references from views', () => {
			const sql = `
				SET search_path to config;
				CREATE OR REPLACE VIEW genders AS
				SELECT lv.id, lv.value, lv.is_active
				  FROM lookups lkp
				 INNER JOIN lookup_values lv ON lv.lookup_id = lkp.id
				 WHERE lkp.name = 'Gender';
			`
			const { references } = extractDependencies(sql)
			const refNames = references.map((r) => r.name)
			expect(refNames).toContain('lookups')
			expect(refNames).toContain('lookup_values')
		})
	})

	describe('extractDependencies() — procedure body references', () => {
		it('extracts table references from procedure body', () => {
			const sql = `
				SET search_path to staging;
				CREATE OR REPLACE PROCEDURE import_lookups()
				LANGUAGE plpgsql AS $$
				BEGIN
					INSERT INTO config.lookups(name) SELECT name FROM staging.lookup_values;
				END;
				$$
			`
			const { references } = extractDependencies(sql)
			const refNames = references.map((r) => r.name)
			expect(refNames).toContain('config.lookups')
			expect(refNames).toContain('staging.lookup_values')
		})

		it('does not extract references from comments', () => {
			const sql = `
				SET search_path to runtime;
				CREATE OR REPLACE FUNCTION log_info(p_message text)
				RETURNS void LANGUAGE plpgsql AS $$
				-- This function logs messages. INFO level (3)
				-- Performance: avoid overhead from syntax checking
				BEGIN
					INSERT INTO runtime.log_messages(level, message) VALUES ('INFO', p_message);
				END;
				$$
			`
			const { references } = extractDependencies(sql)
			const refNames = references.map((r) => r.name)
			// Should find the actual table reference
			expect(refNames).toContain('runtime.log_messages')
			// Should NOT find words from comments
			expect(refNames).not.toContain('level')
			expect(refNames).not.toContain('message')
			expect(refNames).not.toContain('Performance')
			expect(refNames).not.toContain('syntax')
			expect(refNames).not.toContain('overhead')
		})
	})

	describe('extractDependencies() — trigger references', () => {
		it('extracts trigger table and function references', () => {
			const sql = `
				SET search_path to public;
				CREATE OR REPLACE FUNCTION validate_user_email()
				RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

				CREATE TRIGGER auth_user_trigger
				  BEFORE INSERT ON auth.users
				  FOR EACH ROW EXECUTE FUNCTION validate_user_email();
			`
			const { references } = extractDependencies(sql)
			const refNames = references.map((r) => r.name)
			expect(refNames).toContain('auth.users')
			expect(refNames).toContain('validate_user_email')
		})
	})

	describe('collectReferences()', () => {
		it('deduplicates references by name', () => {
			const refs = collectReferences({
				tables: [],
				views: [
					{
						dependencies: [
							{ table: 'users', schema: 'public' },
							{ table: 'users', schema: 'public' }
						]
					}
				],
				procedures: [],
				triggers: []
			})
			expect(refs).toHaveLength(1)
			expect(refs[0].name).toBe('public.users')
		})

		it('collects view dependencies without schema', () => {
			const refs = collectReferences({
				tables: [],
				views: [
					{
						dependencies: [{ table: 'orders' }, { table: 'products' }]
					}
				],
				procedures: [],
				triggers: []
			})
			expect(refs).toHaveLength(2)
			expect(refs.map((r) => r.name)).toEqual(['orders', 'products'])
			expect(refs.every((r) => r.type === 'table/view')).toBe(true)
		})

		it('skips subquery dependencies from views', () => {
			const refs = collectReferences({
				tables: [],
				views: [
					{
						dependencies: [{ type: 'subquery' }, { table: 'users' }]
					}
				],
				procedures: [],
				triggers: []
			})
			expect(refs).toHaveLength(1)
			expect(refs[0].name).toBe('users')
		})

		it('collects trigger table and function references', () => {
			const refs = collectReferences({
				tables: [],
				views: [],
				procedures: [],
				triggers: [
					{
						table: 'users',
						tableSchema: 'public',
						executeFunction: 'validate_email'
					}
				]
			})
			expect(refs).toHaveLength(2)
			expect(refs.find((r) => r.name === 'public.users')).toBeDefined()
			expect(refs.find((r) => r.name === 'validate_email')).toBeDefined()
		})

		it('collects procedure table references', () => {
			const refs = collectReferences({
				tables: [],
				views: [],
				procedures: [{ tableReferences: ['config.lookups', 'staging.data'] }],
				triggers: []
			})
			expect(refs).toHaveLength(2)
			expect(refs.map((r) => r.name)).toEqual(['config.lookups', 'staging.data'])
		})

		it('deduplicates across different source types', () => {
			const refs = collectReferences({
				tables: [
					{
						columns: [
							{
								constraints: [{ type: 'FOREIGN KEY', table: 'users', schema: 'public' }]
							}
						]
					}
				],
				views: [{ dependencies: [{ table: 'users', schema: 'public' }] }],
				procedures: [],
				triggers: []
			})
			expect(refs).toHaveLength(1)
			expect(refs[0].name).toBe('public.users')
		})

		it('returns empty array for no references', () => {
			const refs = collectReferences({
				tables: [],
				views: [],
				procedures: [],
				triggers: []
			})
			expect(refs).toEqual([])
		})
	})
})
