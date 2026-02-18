// dbd/packages/parser/spec/functional/sql.spec.js
import { describe, it, expect } from 'vitest'
import { parse, splitStatements, validateSQL } from '../../src/parsers/sql.js'

describe('SQL Parser - Functional API', () => {
	describe('splitStatements', () => {
		it('should split SQL statements on semicolons', () => {
			const sql = `
        CREATE TABLE users (id int);
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})

		it('should handle semicolons in strings', () => {
			const sql = `
        CREATE TABLE users (message varchar(100) DEFAULT 'Hello; world');
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain("'Hello; world'")
		})

		it('should handle comments', () => {
			const sql = `
        -- This is a comment with a ; semicolon
        CREATE TABLE users (id int); -- Another comment
        /* Comment with ; semicolon */
        CREATE TABLE posts (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})

		it('should handle dollar-quoted strings in PostgreSQL syntax', () => {
			const sql = `
        CREATE FUNCTION test() RETURNS void AS $$
        BEGIN
          RETURN;
        END;
        $$ LANGUAGE plpgsql;
        
        CREATE TABLE test (id int);
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE FUNCTION test')
			expect(statements[1]).toContain('CREATE TABLE test')
		})

		it('should handle empty or whitespace-only statements', () => {
			const sql = `
        ;;
        CREATE TABLE users (id int);
        ;
        CREATE TABLE posts (id int);
        ;
      `

			const statements = splitStatements(sql)
			expect(statements).toHaveLength(2)
			expect(statements[0]).toContain('CREATE TABLE users')
			expect(statements[1]).toContain('CREATE TABLE posts')
		})
	})

	describe('parse', () => {
		it('should parse simple CREATE TABLE statements', () => {
			const sql = 'CREATE TABLE test (id int);'
			const ast = parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThan(0)
			expect(ast[0].type).toBe('create')
			expect(ast[0].keyword).toBe('table')
			expect(ast[0].table[0].table).toBe('test')
		})

		it('should parse multiple statements', () => {
			const sql = `
        CREATE TABLE users (id int);
        CREATE TABLE posts (id int);
      `

			const ast = parse(sql)
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(2)
			expect(ast[0].type).toBe('create')
			expect(ast[1].type).toBe('create')
			expect(ast[0].table[0].table).toBe('users')
			expect(ast[1].table[0].table).toBe('posts')
		})

		it('should store the original SQL for reference', () => {
			const sql = 'CREATE TABLE test (id int);'
			const ast = parse(sql)

			expect(ast._original_sql).toBe(sql)
		})

		it('should parse SET search_path statements', () => {
			const sql = 'SET search_path TO public, my_schema;'
			const ast = parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(1)
			expect(ast[0].type).toBe('set')
			expect(ast[0].variable).toBe('search_path')
			expect(ast[0].value).toContain('public')
			expect(ast[0].value).toContain('my_schema')
		})

		it('should handle errors gracefully', () => {
			// Invalid SQL with missing closing parenthesis
			const sql = 'CREATE TABLE broken (id int;'

			// Should not throw but return an empty array
			expect(() => parse(sql)).not.toThrow()
			const ast = parse(sql)
			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBe(0)
		})
	})

	describe('validateSQL', () => {
		it('should validate correct SQL', () => {
			const sql = 'CREATE TABLE test (id int);'
			const result = validateSQL(sql)

			// Only check the required properties, allowing for additional properties like errors
			expect(result.valid).toBe(true)
			expect(result.message).toBe('Valid SQL')
		})

		it('should invalidate incorrect SQL', () => {
			const sql = 'CREATE TABLE broken (id int;' // Missing closing parenthesis
			const result = validateSQL(sql)

			expect(result.valid).toBe(false)
			expect(result.message).toContain('Error')
		})
	})
})
