import { describe, it, expect } from 'vitest'
import { extractTriggers, extractTriggersFromSql } from '../../../src/parser/extractors/triggers.js'

describe('Trigger Extraction', () => {
	describe('extractTriggersFromSql()', () => {
		it('extracts a basic BEFORE trigger', () => {
			const sql = `
				CREATE TRIGGER auth_user_trigger
				  BEFORE INSERT
				  ON auth.users
				  FOR EACH ROW
				  EXECUTE FUNCTION validate_user_email();
			`
			const result = extractTriggersFromSql(sql, 'public')
			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				name: 'auth_user_trigger',
				schema: 'auth',
				table: 'users',
				tableSchema: 'auth',
				timing: 'BEFORE',
				events: ['INSERT'],
				executeFunction: 'validate_user_email'
			})
		})

		it('extracts trigger with multiple events', () => {
			const sql = `
				CREATE TRIGGER history_trigger
				  BEFORE INSERT OR UPDATE OR DELETE
				  ON public.feature_states
				  FOR EACH ROW
				  EXECUTE FUNCTION historize_feature_states();
			`
			const result = extractTriggersFromSql(sql, 'public')
			expect(result).toHaveLength(1)
			expect(result[0].events).toEqual(['INSERT', 'UPDATE', 'DELETE'])
			expect(result[0].table).toBe('feature_states')
			expect(result[0].tableSchema).toBe('public')
		})

		it('extracts trigger with schema-qualified execute function', () => {
			const sql = `
				CREATE TRIGGER my_trigger
				  AFTER INSERT
				  ON users
				  FOR EACH ROW
				  EXECUTE PROCEDURE audit.log_change();
			`
			const result = extractTriggersFromSql(sql, 'public')
			expect(result).toHaveLength(1)
			expect(result[0].executeFunction).toBe('audit.log_change')
			expect(result[0].tableSchema).toBe('public')
		})

		it('extracts trigger with unqualified table using default schema', () => {
			const sql = `
				CREATE TRIGGER my_trigger
				  AFTER UPDATE
				  ON users
				  FOR EACH ROW
				  EXECUTE FUNCTION update_timestamp();
			`
			const result = extractTriggersFromSql(sql, 'core')
			expect(result).toHaveLength(1)
			expect(result[0].tableSchema).toBe('core')
			expect(result[0].table).toBe('users')
		})

		it('returns empty array for SQL without triggers', () => {
			const sql = 'CREATE TABLE users (id int PRIMARY KEY);'
			expect(extractTriggersFromSql(sql, 'public')).toEqual([])
		})

		it('extracts multiple triggers', () => {
			const sql = `
				CREATE TRIGGER trigger_a BEFORE INSERT ON table_a
				  FOR EACH ROW EXECUTE FUNCTION func_a();
				CREATE TRIGGER trigger_b AFTER UPDATE ON table_b
				  FOR EACH ROW EXECUTE FUNCTION func_b();
			`
			const result = extractTriggersFromSql(sql, 'public')
			expect(result).toHaveLength(2)
			expect(result[0].name).toBe('trigger_a')
			expect(result[1].name).toBe('trigger_b')
		})
	})

	describe('extractTriggers()', () => {
		it('works with null/empty inputs', () => {
			expect(extractTriggers(null, null)).toEqual([])
			expect(extractTriggers([], '')).toEqual([])
		})

		it('uses null searchPath when ast is not an array', () => {
			const sql = `
				CREATE TRIGGER my_trigger
				  BEFORE INSERT ON users
				  FOR EACH ROW EXECUTE FUNCTION validate_user();
			`
			const result = extractTriggers('not-an-array', sql)
			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('my_trigger')
			expect(result[0].tableSchema).toBeNull()
		})
	})
})
