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
	extractProcedureReturnType,
	extractTableReferencesFromBody,
	extractProceduresFromSql,
	extractBodyReferencesFromAst,
	extractProcedureFromOriginal,
	extractParameterDataType,
	extractParameterMode
} from '../../../src/parser/extractors/procedures.js'

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

			const { reads, writes } = extractTableReferencesFromBody(body)

			expect(writes).toContain('users')
			expect(writes).toContain('orders')
			expect(reads).toContain('products')
			expect(reads).toContain('categories')
			expect(reads.length + writes.length).toBe(4)
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
			expect(procedures[0].writes).toContain('orders')
		})

		it('should extract INOUT parameter in regex path', () => {
			const sql = `
        CREATE FUNCTION inc(INOUT p_val INT)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          p_val := p_val + 1;
        END;
        $$;
      `
			const procs = extractProceduresFromSql(sql, 'public')
			expect(procs[0].parameters[0].mode).toBe('inout')
			expect(procs[0].parameters[0].name).toBe('p_val')
		})
	})

	describe('Additional coverage', () => {
		it('should extract procedures from original statement', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'function',
					name: { name: [{ value: 'my_func' }], schema: null },
					original: `CREATE FUNCTION my_func(p_id int) LANGUAGE plpgsql AS $$ BEGIN INSERT INTO logs(id) VALUES (p_id); END; $$;`,
					language: 'plpgsql',
					parameters: [],
					as: ''
				}
			]
			const procs = extractProcedures(ast)
			expect(procs.length).toBe(1)
			expect(procs[0].name).toBe('my_func')
		})

		it('should extract function name via name.name[0].value', () => {
			expect(
				extractProcedureName({
					keyword: 'function',
					name: { name: [{ value: 'calc_total' }] }
				})
			).toBe('calc_total')
		})

		it('should extract function schema via name.schema', () => {
			expect(
				extractProcedureSchema({
					keyword: 'function',
					name: { name: [{ value: 'f' }], schema: 'staging' }
				})
			).toBe('staging')
		})

		it('should return null schema for function without schema', () => {
			expect(
				extractProcedureSchema({
					keyword: 'function',
					name: { name: [{ value: 'f' }] }
				})
			).toBeNull()
		})

		it('should extract language from options array', () => {
			expect(
				extractProcedureLanguage({
					options: [{ prefix: 'LANGUAGE', value: 'sql' }]
				})
			).toBe('sql')
		})

		it('should extract return type', () => {
			expect(extractProcedureReturnType({ returns: 'int' })).toBe('int')
			expect(extractProcedureReturnType({})).toBeNull()
		})

		it('should return empty string for body without as property', () => {
			expect(extractProcedureBody({})).toBe('')
		})

		it('should exclude PL/pgSQL keywords from table references', () => {
			const body = `
        BEGIN
          IF FOUND THEN
            RETURN NEW;
          END IF;
          INSERT INTO audit_log(entity) VALUES ('test');
          PERFORM STRICT 1;
        END;
      `
			const { reads, writes } = extractTableReferencesFromBody(body)
			expect(writes).toContain('audit_log')
			expect(reads).not.toContain('FOUND')
			expect(writes).not.toContain('FOUND')
			expect(reads).not.toContain('NEW')
			expect(writes).not.toContain('NEW')
			expect(reads).not.toContain('STRICT')
			expect(writes).not.toContain('STRICT')
		})

		it('should return empty reads and writes for null/undefined body', () => {
			expect(extractTableReferencesFromBody(null)).toEqual({ reads: [], writes: [] })
			expect(extractTableReferencesFromBody(undefined)).toEqual({ reads: [], writes: [] })
		})

		it('should return empty params when none provided', () => {
			expect(extractProcedureParameters({})).toEqual([])
		})

		it('should handle string dataType in parameters', () => {
			const params = extractProcedureParameters({
				parameters: [{ name: 'x', dataType: 'TEXT', mode: 'in' }]
			})
			expect(params[0].dataType).toBe('text')
		})

		it('returns empty array for non-array ast', () => {
			expect(extractProcedures('not an array')).toEqual([])
			expect(extractProcedures(null)).toEqual([])
		})

		it('extracts procedure name via .name fallback on object procedure', () => {
			expect(
				extractProcedureName({
					procedure: { name: 'my_proc' }
				})
			).toBe('my_proc')
		})

		it('returns empty string for missing procedure name', () => {
			expect(extractProcedureName({})).toBe('')
		})

		it('extractBodyReferencesFromAst returns empty for no options', () => {
			expect(extractBodyReferencesFromAst({})).toEqual({ reads: [], writes: [] })
			expect(extractBodyReferencesFromAst({ options: 'not array' })).toEqual({
				reads: [],
				writes: []
			})
		})

		it('extractBodyReferencesFromAst returns empty when no as option', () => {
			expect(
				extractBodyReferencesFromAst({
					options: [{ type: 'language', value: 'plpgsql' }]
				})
			).toEqual({ reads: [], writes: [] })
		})

		it('extractBodyReferencesFromAst returns empty when as has no expr array', () => {
			expect(
				extractBodyReferencesFromAst({
					options: [{ type: 'as', expr: 'not array' }]
				})
			).toEqual({ reads: [], writes: [] })
		})

		it('extractBodyReferencesFromAst extracts table refs from AST body', () => {
			const { reads } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								table: [{ db: 'config', table: 'lookups' }],
								from: [{ db: 'staging', table: 'data' }]
							}
						]
					}
				]
			})
			expect(reads).toContain('config.lookups')
			expect(reads).toContain('staging.data')
		})

		it('extractBodyReferencesFromAst handles table without db prefix', () => {
			const { reads } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								table: [{ table: 'users' }],
								from: [{ table: 'orders' }]
							}
						]
					}
				]
			})
			expect(reads).toContain('users')
			expect(reads).toContain('orders')
		})

		it('extractProcedureFromOriginal returns null for non-matching SQL', () => {
			expect(extractProcedureFromOriginal('SELECT 1;', null)).toBeNull()
		})

		it('extractRoutinesFromSql handles function without explicit language', () => {
			const procs = extractProceduresFromSql(
				'CREATE FUNCTION do_it() RETURNS void AS $$ BEGIN NULL; END; $$;',
				'public'
			)
			expect(procs[0].language).toBe('plpgsql')
		})

		it('extractRoutinesFromSql handles body in single quotes', () => {
			const procs = extractProceduresFromSql(
				"CREATE FUNCTION f() RETURNS void LANGUAGE sql AS 'SELECT 1';",
				'public'
			)
			expect(procs[0].body).toBe('SELECT 1')
		})

		it('extractParameterDataType returns unknown when no dataType', () => {
			expect(extractParameterDataType({})).toBe('unknown')
			expect(extractParameterDataType({ name: 'x' })).toBe('unknown')
		})

		it('extractParameterMode defaults to in when no mode', () => {
			expect(extractParameterMode({})).toBe('in')
			expect(extractParameterMode({ name: 'x' })).toBe('in')
		})

		it('extractBodyReferencesFromAst handles null/non-object nodes in expr array', () => {
			const { reads } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [null, 'string-node', { table: [{ table: 'real_table' }] }]
					}
				]
			})
			expect(reads).toContain('real_table')
		})

		it('extractParameterDataType handles nested dataType.dataType object', () => {
			// Line 165: else if (param.dataType.dataType) branch
			expect(extractParameterDataType({ dataType: { dataType: 'INTEGER' } })).toBe('integer')
		})

		it('extractParameterDataType returns unknown when dataType is object without dataType key', () => {
			expect(extractParameterDataType({ dataType: {} })).toBe('unknown')
		})

		it('extractProcedureLanguage returns plpgsql when options has no LANGUAGE entry (line 132: false)', () => {
			// Line 132: if (langOpt) — langOpt is undefined when no LANGUAGE in options
			expect(
				extractProcedureLanguage({
					options: [{ prefix: 'AS', value: '...' }]
				})
			).toBe('plpgsql')
		})

		it('extractBodyReferencesFromAst handles table with db prefix in table array (line 224-225)', () => {
			// Lines 222-224: schema-qualified table reference in node.table array
			const { reads } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								table: [{ db: 'app', table: 'users' }]
							}
						]
					}
				]
			})
			expect(reads).toContain('app.users')
		})

		it('extractBodyReferencesFromAst handles FROM clause with db prefix (line 233)', () => {
			// Line 233: schema-qualified table in FROM clause
			const { reads } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								from: [{ db: 'reporting', table: 'metrics' }]
							}
						]
					}
				]
			})
			expect(reads).toContain('reporting.metrics')
		})

		it('extractBodyReferencesFromAst skips table entries without table name (line 224: false)', () => {
			// t.table is falsy — skipped
			const { reads, writes } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								table: [{ db: 'app' }] // no table property
							}
						]
					}
				]
			})
			expect(reads).toHaveLength(0)
			expect(writes).toHaveLength(0)
		})

		it('extractBodyReferencesFromAst skips FROM entries without table name (line 233: false)', () => {
			// f.table is falsy — skipped
			const { reads, writes } = extractBodyReferencesFromAst({
				options: [
					{
						type: 'as',
						expr: [
							{
								from: [{ db: 'app' }] // no table property
							}
						]
					}
				]
			})
			expect(reads).toHaveLength(0)
			expect(writes).toHaveLength(0)
		})
	})
})
