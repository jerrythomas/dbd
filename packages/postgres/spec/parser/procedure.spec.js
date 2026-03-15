// dbd/packages/parser/spec/procedure.spec.js
import { describe, it, expect } from 'vitest'
import {
	importJsonbProcedureDDL,
	importLookupsProcedureDDL,
	complexProcedureDDL
} from './fixtures/ddl-samples.js'
import { SQLParser } from '../../src/parser/parser-utils.js'

describe('SQL Parser - Procedure Definitions', () => {
	const parser = new SQLParser()

	describe('Basic Procedure Parsing', () => {
		it.skip('should parse simple procedure definitions', () => {
			const sql = `
        CREATE OR REPLACE PROCEDURE simple_procedure()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          DELETE FROM temp_table;
        END;
        $$;
      `
			const ast = parser.parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThan(0)

			const createProcStmt = ast.find(
				(stmt) => stmt.type === 'create' && stmt.keyword === 'procedure'
			)
			expect(createProcStmt).toBeDefined()
			expect(createProcStmt.procedure).toBe('simple_procedure')
			expect(createProcStmt.replace).toBe(true)
			expect(createProcStmt.language).toBe('plpgsql')

			// Check procedure body
			expect(createProcStmt.as).toBeDefined()
			expect(typeof createProcStmt.as).toBe('string')
			expect(createProcStmt.as).toContain('BEGIN')
			expect(createProcStmt.as).toContain('END')
		})

		it.skip('should parse procedures with parameters', () => {
			const sql = `
        CREATE PROCEDURE with_params(
          param1 INT,
          param2 VARCHAR,
          OUT result BOOLEAN
        )
        LANGUAGE plpgsql
        AS $$
        BEGIN
          result := true;
        END;
        $$;
      `
			const ast = parser.parse(sql)

			const createProcStmt = ast.find(
				(stmt) => stmt.type === 'create' && stmt.keyword === 'procedure'
			)
			expect(createProcStmt).toBeDefined()

			// Check parameters
			expect(createProcStmt.parameters).toBeInstanceOf(Array)
			expect(createProcStmt.parameters.length).toBe(3)

			const param1 = createProcStmt.parameters.find((p) => p.name === 'param1')
			expect(param1).toBeDefined()
			expect(param1.dataType.dataType).toBe('INT')

			const outParam = createProcStmt.parameters.find((p) => p.mode === 'OUT')
			expect(outParam).toBeDefined()
			expect(outParam.name).toBe('result')
		})
	})

	describe('Complex Procedure Features', () => {
		it.skip('should parse procedures with transaction control', () => {
			const sql = `
        CREATE PROCEDURE with_transaction()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          BEGIN
            INSERT INTO audit_log(action) VALUES ('start');

            -- Do something that might fail
            UPDATE accounts SET balance = balance - 100 WHERE id = 1;

            COMMIT;
          EXCEPTION
            WHEN OTHERS THEN
              ROLLBACK;
              RAISE;
          END;
        END;
        $$;
      `
			const ast = parser.parse(sql)

			const createProcStmt = ast.find(
				(stmt) => stmt.type === 'create' && stmt.keyword === 'procedure'
			)
			expect(createProcStmt).toBeDefined()

			// Check for transaction keywords in body
			expect(createProcStmt.as).toContain('COMMIT')
			expect(createProcStmt.as).toContain('ROLLBACK')
			expect(createProcStmt.as).toContain('EXCEPTION')
		})

		it.skip('should parse procedures with conditional logic', () => {
			const sql = `
        CREATE PROCEDURE with_conditionals(value INT)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF value > 100 THEN
            INSERT INTO large_values(val) VALUES (value);
          ELSIF value > 0 THEN
            INSERT INTO small_values(val) VALUES (value);
          ELSE
            RAISE NOTICE 'Invalid value: %', value;
          END IF;
        END;
        $$;
      `
			const ast = parser.parse(sql)

			const createProcStmt = ast.find(
				(stmt) => stmt.type === 'create' && stmt.keyword === 'procedure'
			)
			expect(createProcStmt).toBeDefined()

			// Check for conditional keywords in body
			expect(createProcStmt.as).toContain('IF')
			expect(createProcStmt.as).toContain('THEN')
			expect(createProcStmt.as).toContain('ELSE')
			expect(createProcStmt.as).toContain('END IF')
		})
	})

	describe('Procedure Extraction', () => {
		it.skip('should extract procedure definitions using extractProcedureDefinitions', () => {
			const sql = `
        CREATE PROCEDURE extract_test(param1 VARCHAR)
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO log(message) VALUES ('Procedure called');
        END;
        $$;
      `

			const procedures = parser.extractProcedureDefinitions(parser.parse(sql))

			expect(procedures).toBeInstanceOf(Array)
			expect(procedures.length).toBe(1)

			const proc = procedures[0]
			expect(proc.name).toBe('extract_test')
			expect(proc.language).toBe('plpgsql')

			// Check parameters
			expect(proc.parameters).toBeInstanceOf(Array)
			expect(proc.parameters.length).toBe(1)
			expect(proc.parameters[0].name).toBe('param1')
			expect(proc.parameters[0].dataType).toBe('VARCHAR')

			// Check body
			expect(proc.body).toBeDefined()
			expect(proc.body).toContain('BEGIN')
			expect(proc.body).toContain('INSERT INTO log')
		})

		it.skip('should extract table references from procedure body', () => {
			const sql = `
        CREATE PROCEDURE with_table_refs()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO table1 SELECT * FROM table2;
          UPDATE table3 SET col = 'value';
          DELETE FROM table4;
        END;
        $$;
      `

			const procedures = parser.extractProcedureDefinitions(parser.parse(sql))

			expect(procedures.length).toBe(1)
			const proc = procedures[0]

			// Check table references
			expect(proc.tableReferences).toBeInstanceOf(Array)
			expect(proc.tableReferences.length).toBe(4)
			expect(proc.tableReferences).toContain('table1')
			expect(proc.tableReferences).toContain('table2')
			expect(proc.tableReferences).toContain('table3')
			expect(proc.tableReferences).toContain('table4')
		})
	})

	describe('Schema Extraction with Procedures', () => {
		it.skip('should include procedures in schema extraction', () => {
			const sql = `
        CREATE TABLE test_table (id INT PRIMARY KEY);

        CREATE PROCEDURE test_proc()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          DELETE FROM test_table;
        END;
        $$;
      `

			const schema = parser.extractSchema(sql)

			expect(schema.tables).toBeInstanceOf(Array)
			expect(schema.tables.length).toBe(1)

			expect(schema.procedures).toBeInstanceOf(Array)
			expect(schema.procedures.length).toBe(1)
			expect(schema.procedures[0].name).toBe('test_proc')

			// Check that procedure references the table
			expect(schema.procedures[0].tableReferences).toContain('test_table')
		})
	})

	describe('Error Handling', () => {
		it('should handle procedures with syntax errors gracefully', () => {
			// Note: pgsql-parser treats dollar-quoted body as opaque text,
			// so PL/pgSQL body errors are NOT detected at DDL level.
			// Use actual DDL-level syntax errors instead.
			const sql = `CREATE PROCEDURE broken_proc( LANGUAGE plpgsql;`

			// Parser should return an array even with syntax errors
			const ast = parser.parse(sql)
			expect(ast).toBeInstanceOf(Array)

			// Validation should show the error
			const validation = parser.validateDDL(sql)
			expect(validation.valid).toBe(false)
			expect(validation.message).toBeDefined()
		})

		it('should parse procedures with body errors as valid DDL', () => {
			// Dollar-quoted body is opaque — missing semicolon inside body is not a DDL error
			const sql = `
        CREATE PROCEDURE body_error_proc()
        LANGUAGE plpgsql
        AS $$
        BEGIN
          INSERT INTO log VALUES (1)
        END;
        $$;
      `
			const ast = parser.parse(sql)
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(1)
			expect(ast[0].keyword).toBe('procedure')
		})
	})
})
