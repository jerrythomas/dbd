/**
 * Tests for the parser public API (packages/parser/src/index.js facade).
 */
import { describe, it, expect } from 'vitest'
import {
	parseSchema,
	validate,
	extractTables,
	extractViews,
	extractProcedures,
	extractIndexes
} from '../src/index.js'

describe('Parser public API', () => {
	const tableDDL = 'CREATE TABLE users (id int PRIMARY KEY, name varchar(100));'
	const viewDDL = 'CREATE VIEW active_users AS SELECT * FROM users WHERE active = true;'
	const procDDL = `CREATE PROCEDURE refresh_data()
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW active_users;
END;
$$;`
	const indexDDL = 'CREATE INDEX idx_users_name ON users (name);'
	const funcDDL = `CREATE FUNCTION get_user(p_id int)
RETURNS TABLE(id int, name varchar)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT u.id, u.name FROM users u WHERE u.id = p_id;
END;
$$;`

	describe('parseSchema', () => {
		it('extracts full schema from DDL', () => {
			const result = parseSchema(tableDDL)
			expect(result).toHaveProperty('tables')
			expect(result.tables).toHaveLength(1)
			expect(result.tables[0].name).toBe('users')
		})
	})

	describe('validate', () => {
		it('returns valid for correct DDL', () => {
			const result = validate(tableDDL)
			expect(result.valid).toBe(true)
		})

		it('returns invalid for bad DDL', () => {
			const result = validate('NOT VALID SQL AT ALL (')
			expect(result.valid).toBe(false)
		})
	})

	describe('extractTables', () => {
		it('extracts table definitions', () => {
			const tables = extractTables(tableDDL)
			expect(tables).toHaveLength(1)
			expect(tables[0].name).toBe('users')
			expect(tables[0].columns).toHaveLength(2)
		})
	})

	describe('extractViews', () => {
		it('extracts view definitions', () => {
			const views = extractViews(viewDDL)
			expect(views).toHaveLength(1)
			expect(views[0].name).toBe('active_users')
		})
	})

	describe('extractProcedures', () => {
		it('extracts procedure definitions', () => {
			const procs = extractProcedures(procDDL)
			expect(procs).toHaveLength(1)
			expect(procs[0].name).toBe('refresh_data')
		})

		it('extracts function definitions', () => {
			const procs = extractProcedures(funcDDL)
			expect(procs).toHaveLength(1)
			expect(procs[0].name).toBe('get_user')
		})
	})

	describe('extractIndexes', () => {
		it('extracts index definitions', () => {
			const indexes = extractIndexes(indexDDL)
			expect(indexes).toHaveLength(1)
			expect(indexes[0].name).toBe('idx_users_name')
			expect(indexes[0].table).toBe('users')
		})
	})
})
