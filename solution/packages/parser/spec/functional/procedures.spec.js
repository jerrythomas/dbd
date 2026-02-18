// dbd/packages/parser/spec/functional/procedures.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractProcedures,
	extractProcedureName,
	extractProcedureSchema,
	extractIsReplace,
	extractProcedureLanguage,
	extractProcedureParameters,
	extractProcedureBody,
	extractTableReferencesFromBody,
	extractProceduresFromSql
} from '../../src/extractors/procedures.js'

describe('Procedure Extractor - Functional API', () => {
	describe('extractProcedures', () => {
		it('should extract basic procedure definitions', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'procedure',
					procedure: 'simple_procedure',
					replace: false,
					language: 'plpgsql',
					parameters: [
						{
							name: 'param1',
							dataType: { dataType: 'int' },
							mode: 'in'
						}
					],
					as: 'BEGIN\n  RETURN;\nEND;'
				}
			]

			const procedures = extractProcedures(ast)

			expect(procedures).toBeInstanceOf(Array)
			expect(procedures.length).toBe(1)

			const proc = procedures[0]
			expect(proc.name).toBe('simple_procedure')
			expect(proc.language).toBe('plpgsql')
			expect(proc.parameters.length).toBe(1)
			expect(proc.parameters[0].name).toBe('param1')
			expect(proc.parameters[0].dataType).toBe('int')
			expect(proc.body).toBe('BEGIN\n  RETURN;\nEND;')
		})

		it('should handle OR REPLACE procedures', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'procedure',
					procedure: 'test_proc',
					replace: 'or replace',
					language: 'sql',
					parameters: [],
					as: 'SELECT 1;'
				}
			]

			const procedures = extractProcedures(ast)

			expect(procedures.length).toBe(1)
			expect(procedures[0].replace).toBe(true)
		})

		it('should handle procedures with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'procedure',
					procedure: {
						procedure: 'analytics_proc',
						schema: 'reporting'
					},
					language: 'plpgsql',
					as: 'BEGIN\n  NULL;\nEND;'
				}
			]

			const procedures = extractProcedures(ast)

			expect(procedures.length).toBe(1)
			expect(procedures[0].name).toBe('analytics_proc')
			expect(procedures[0].schema).toBe('reporting')
		})

		it('should fallback to regex extraction when AST extraction fails', () => {
			const ast = []
			ast._original_sql = `
        CREATE OR REPLACE PROCEDURE reporting.import_data(source_table varchar, target_table varchar)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          EXECUTE 'INSERT INTO ' || target_table || ' SELECT * FROM ' || source_table;
        END;
        $$;
      `

			const procedures = extractProcedures(ast)

			expect(procedures.length).toBe(1)
			expect(procedures[0].name).toBe('import_data')
			expect(procedures[0].schema).toBe('reporting')
			expect(procedures[0].replace).toBe(true)
			expect(procedures[0].parameters.length).toBe(2)
			expect(procedures[0].body).toContain('INSERT INTO')
		})
	})

	describe('Component extraction utilities', () => {
		it('should extract procedure names correctly', () => {
			expect(extractProcedureName({ procedure: 'simple_proc' })).toBe('simple_proc')
			expect(
				extractProcedureName({
					procedure: { procedure: 'complex_proc', schema: 'app' }
				})
			).toBe('complex_proc')
		})

		it('should extract procedure schemas correctly', () => {
			expect(extractProcedureSchema({ procedure: 'simple_proc' })).toBeNull()
			expect(
				extractProcedureSchema({
					procedure: { procedure: 'complex_proc', schema: 'app' }
				})
			).toBe('app')
			expect(extractProcedureSchema({ procedure: 'proc', schema: 'public' })).toBe('public')
		})

		it('should detect CREATE OR REPLACE correctly', () => {
			expect(extractIsReplace({ replace: 'or replace' })).toBe(true)
			expect(extractIsReplace({ replace: false })).toBe(false)
			expect(extractIsReplace({ or_replace: true })).toBe(true)
			expect(extractIsReplace({})).toBe(false)
		})

		it('should extract procedure language correctly', () => {
			expect(extractProcedureLanguage({ language: 'sql' })).toBe('sql')
			expect(extractProcedureLanguage({ language: 'plpgsql' })).toBe('plpgsql')
			expect(extractProcedureLanguage({})).toBe('plpgsql') // Default value
		})

		it('should extract procedure parameters correctly', () => {
			const stmt = {
				parameters: [
					{
						name: 'id',
						dataType: { dataType: 'INT' },
						mode: 'IN'
					},
					{
						name: 'result',
						dataType: { dataType: 'BOOLEAN' },
						mode: 'OUT'
					}
				]
			}

			const params = extractProcedureParameters(stmt)

			expect(params.length).toBe(2)
			expect(params[0].name).toBe('id')
			expect(params[0].dataType).toBe('int')
			expect(params[0].mode).toBe('in')
			expect(params[1].name).toBe('result')
			expect(params[1].mode).toBe('out')
		})

		it('should extract table references from procedure bodies', () => {
			const body = `
        BEGIN
          INSERT INTO users (name) VALUES ('test');
          UPDATE orders SET status = 'shipped';
          SELECT * FROM products JOIN categories ON categories.id = products.category_id;
        END;
      `

			const tables = extractTableReferencesFromBody(body)

			expect(tables).toContain('users')
			expect(tables).toContain('orders')
			expect(tables).toContain('products')
			expect(tables).toContain('categories')
			expect(tables.length).toBe(4)
		})
	})

	describe('SQL text extraction', () => {
		it('should extract procedures from SQL text', () => {
			const sql = `
        CREATE OR REPLACE PROCEDURE process_order(order_id INT, OUT success BOOLEAN)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          UPDATE orders SET processed = TRUE WHERE id = order_id;
          success := TRUE;
        EXCEPTION
          WHEN OTHERS THEN
            success := FALSE;
        END;
        $$;
      `

			const procedures = extractProceduresFromSql(sql, 'public')

			expect(procedures.length).toBe(1)
			expect(procedures[0].name).toBe('process_order')
			expect(procedures[0].replace).toBe(true)
			expect(procedures[0].parameters.length).toBe(2)
			expect(procedures[0].parameters[0].name).toBe('order_id')
			expect(procedures[0].parameters[0].dataType).toContain('int')
			expect(procedures[0].parameters[1].mode).toBe('out')
			expect(procedures[0].tableReferences).toContain('orders')
		})
	})
})
