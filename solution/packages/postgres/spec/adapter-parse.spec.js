import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { PsqlAdapter } from '../src/psql-adapter.js'
import { resetCache } from '../src/reference-classifier.js'

// The WASM parser is initialized by spec/parser/setup.js (vitest setupFiles)

const TMP_DIR = join(import.meta.dirname, '.tmp-adapter-parse')

function writeTmpFile(name, content) {
	if (!existsSync(TMP_DIR)) {
		mkdirSync(TMP_DIR, { recursive: true })
	}
	const file = join(TMP_DIR, name)
	writeFileSync(file, content)
	return file
}

afterAll(() => {
	if (existsSync(TMP_DIR)) {
		for (const f of readdirSync(TMP_DIR)) {
			unlinkSync(join(TMP_DIR, f))
		}
		rmSync(TMP_DIR, { recursive: true })
	}
})

describe('PsqlAdapter — parse methods', () => {
	const adapter = new PsqlAdapter('postgresql://localhost/testdb')

	describe('initParser', () => {
		it('should resolve without error', async () => {
			await expect(adapter.initParser()).resolves.toBeUndefined()
		})
	})

	describe('parseScript', () => {
		it('should extract entity, searchPaths, and references from table DDL', () => {
			const sql = `
				SET search_path TO staging;
				CREATE TABLE users (
					id uuid PRIMARY KEY,
					name varchar(100)
				);
			`
			const result = adapter.parseScript(sql)

			expect(result).toHaveProperty('entity')
			expect(result).toHaveProperty('searchPaths')
			expect(result).toHaveProperty('references')
			expect(result.entity.name).toBe('users')
			expect(result.entity.type).toBe('table')
			expect(result.searchPaths).toContain('staging')
		})

		it('should extract references from a view with dependencies', () => {
			const sql = `
				CREATE VIEW active_users AS
				SELECT u.id, u.name
				FROM users u
				WHERE u.is_active = true;
			`
			const result = adapter.parseScript(sql)

			expect(result.entity.name).toBe('active_users')
			expect(result.entity.type).toBe('view')
			expect(result.references.some((r) => r.name === 'users')).toBe(true)
		})

		it('should handle empty SQL gracefully', () => {
			const result = adapter.parseScript('')
			expect(result).toHaveProperty('entity')
			expect(result).toHaveProperty('references')
		})
	})

	describe('parseEntityScript', () => {
		it('should parse a table DDL file via AST', () => {
			const sql = `SET search_path TO staging;
CREATE TABLE users (
  id uuid PRIMARY KEY,
  name varchar(100),
  email varchar(255)
);`
			const file = writeTmpFile('users.sql', sql)
			const entity = { file, schema: 'staging', type: 'table', name: 'staging.users' }

			const result = adapter.parseEntityScript(entity)

			expect(result.name).toBe('staging.users')
			expect(result.type).toBe('table')
			expect(result.schema).toBe('staging')
			expect(result.searchPaths).toContain('staging')
			expect(result.errors).toEqual([])
			expect(result.references).toBeInstanceOf(Array)
		})

		it('should parse a view with references', () => {
			const sql = `SET search_path TO staging;
CREATE VIEW active_users AS
SELECT u.id, u.name FROM users u WHERE u.is_active = true;`
			const file = writeTmpFile('active_users.sql', sql)
			const entity = { file, schema: 'staging', type: 'view', name: 'staging.active_users' }

			const result = adapter.parseEntityScript(entity)

			expect(result.name).toBe('staging.active_users')
			expect(result.type).toBe('view')
			expect(result.references.some((r) => r.name === 'users')).toBe(true)
		})

		it('should report errors when schema mismatches', () => {
			const sql = `SET search_path TO config;
CREATE TABLE lookups (id uuid PRIMARY KEY);`
			const file = writeTmpFile('lookups.sql', sql)
			const entity = { file, schema: 'staging', type: 'table', name: 'staging.lookups' }

			const result = adapter.parseEntityScript(entity)

			expect(result.errors.length).toBeGreaterThan(0)
			expect(result.errors).toContain('Schema in script does not match file path')
		})

		it('should fall back to regex when AST parsing fails', () => {
			// PL/pgSQL function bodies often fail AST parsing
			const sql = `SET search_path TO staging;
CREATE OR REPLACE FUNCTION import_lookups(p_config text)
RETURNS void AS $$
BEGIN
  PERFORM staging.load_data(p_config);
END;
$$ LANGUAGE plpgsql;`
			const file = writeTmpFile('import_lookups.sql', sql)
			const entity = {
				file,
				schema: 'staging',
				type: 'function',
				name: 'staging.import_lookups'
			}

			const result = adapter.parseEntityScript(entity)

			expect(result.name).toBe('staging.import_lookups')
			expect(result.type).toBe('function')
			expect(result.searchPaths).toContain('staging')
		})

		it('should fall back to regex when AST returns no entity identity', () => {
			// An INSERT statement — AST parses but identifyEntity returns null
			const sql = `set search_path to staging;
INSERT INTO staging.data (id) VALUES (1);`
			const file = writeTmpFile('no_entity.sql', sql)
			const entity = {
				file,
				schema: 'staging',
				type: 'function',
				name: 'staging.no_entity'
			}

			const result = adapter.parseEntityScript(entity)
			// Regex fallback returns the entity enriched with whatever it can extract
			expect(result).toBeDefined()
			expect(result.file).toBe(file)
		})
	})

	describe('classifyReference', () => {
		beforeEach(() => {
			resetCache()
		})

		it('should classify ANSI SQL builtins as internal', () => {
			expect(adapter.classifyReference('count')).toBe('internal')
			expect(adapter.classifyReference('avg')).toBe('internal')
			expect(adapter.classifyReference('coalesce')).toBe('internal')
			expect(adapter.classifyReference('MAX')).toBe('internal')
		})

		it('should classify PostgreSQL builtins as internal', () => {
			expect(adapter.classifyReference('now')).toBe('internal')
			expect(adapter.classifyReference('pg_catalog.pg_class')).toBe('internal')
			expect(adapter.classifyReference('array_agg')).toBe('internal')
			expect(adapter.classifyReference('json_build_object')).toBe('internal')
		})

		it('should classify extension functions when extension is installed', () => {
			expect(adapter.classifyReference('uuid_generate_v4', ['uuid-ossp'])).toBe('extension')
			expect(adapter.classifyReference('create_hypertable', ['timescaledb'])).toBe('extension')
		})

		it('should return null for unknown references', () => {
			expect(adapter.classifyReference('my_custom_func')).toBeNull()
			expect(adapter.classifyReference('app.do_something')).toBeNull()
		})

		it('should return null for extension functions when extension is not installed', () => {
			expect(adapter.classifyReference('uuid_generate_v4')).toBeNull()
			expect(adapter.classifyReference('uuid_generate_v4', [])).toBeNull()
		})
	})
})
