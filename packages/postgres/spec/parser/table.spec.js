// dbd/packages/parser/spec/table.spec.js
import { describe, it, expect } from 'vitest'
import {
	lookupTableDDL,
	lookupValueTableDDL,
	stagingLookupValueTableDDL
} from './fixtures/ddl-samples.js'
import { SQLParser } from '../../src/parser/parser-utils.js'

describe('SQL Parser - Table Definitions', () => {
	const parser = new SQLParser()

	describe('Parse Basic SQL Statements', () => {
		it('should parse CREATE TABLE statements', () => {
			// Simple create table statement
			const sql = `CREATE TABLE test_table (id int, name varchar(50));`
			const ast = parser.parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThan(0)

			const createTableStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'table')
			expect(createTableStmt).toBeDefined()
			expect(createTableStmt.table[0].table).toBe('test_table')
		})

		it('should parse SQL with search_path', () => {
			// SQL with search path and create table
			const sql = `
        SET search_path TO public;
        CREATE TABLE test_table (id int);
      `
			const ast = parser.parse(sql)

			expect(ast).toBeInstanceOf(Array)
			// At least we should have the CREATE TABLE statement
			expect(ast.some((stmt) => stmt.type === 'create' && stmt.keyword === 'table')).toBe(true)
		})

		it('should handle multiple statements', () => {
			const sql = `
        CREATE TABLE table1 (id int);
        CREATE TABLE table2 (id int);
      `
			const ast = parser.parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThanOrEqual(2)

			const tableNames = ast
				.filter((stmt) => stmt.type === 'create' && stmt.keyword === 'table')
				.map((stmt) => stmt.table[0].table)

			expect(tableNames).toContain('table1')
			expect(tableNames).toContain('table2')
		})
	})

	describe('Table Extraction', () => {
		it('should extract basic table definition', () => {
			const sql = `CREATE TABLE users (
        id int PRIMARY KEY,
        name varchar(100) NOT NULL,
        created_at timestamp DEFAULT now()
      );`

			const ast = parser.parse(sql)
			const tables = parser.extractTableDefinitions(ast)

			expect(tables).toBeInstanceOf(Array)
			expect(tables.length).toBe(1)

			const table = tables[0]
			expect(table.name).toBe('users')
			expect(table.columns.length).toBe(3)

			// Check specific columns
			const idCol = table.columns.find((c) => c.name === 'id')
			expect(idCol).toBeDefined()
			expect(idCol.dataType).toContain('int')
			expect(idCol.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)

			const nameCol = table.columns.find((c) => c.name === 'name')
			expect(nameCol).toBeDefined()
			expect(nameCol.dataType).toContain('varchar')
			expect(nameCol.nullable).toBe(false)
		})

		it('should extract tables with foreign keys', () => {
			const sql = `
        CREATE TABLE categories (
          id int PRIMARY KEY,
          name varchar(50)
        );

        CREATE TABLE products (
          id int PRIMARY KEY,
          name varchar(100),
          category_id int REFERENCES categories(id)
        );
      `

			const tables = parser.extractTableDefinitions(parser.parse(sql))

			expect(tables).toBeInstanceOf(Array)
			expect(tables.length).toBe(2)

			// Find products table
			const productsTable = tables.find((t) => t.name === 'products')
			expect(productsTable).toBeDefined()

			// Check foreign key
			const categoryIdCol = productsTable.columns.find((c) => c.name === 'category_id')
			expect(categoryIdCol).toBeDefined()

			const fkConstraint = categoryIdCol.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fkConstraint).toBeDefined()
			expect(fkConstraint.table).toBe('categories')
		})

		it('should handle table comments', () => {
			const sql = `
        CREATE TABLE users (
          id int PRIMARY KEY,
          name varchar(100)
        );

        COMMENT ON TABLE users IS 'User accounts table';
        COMMENT ON COLUMN users.id IS 'Primary key';
        COMMENT ON COLUMN users.name IS 'User display name';
      `

			const tables = parser.extractTableDefinitions(parser.parse(sql))

			expect(tables).toBeInstanceOf(Array)
			expect(tables.length).toBe(1)

			const table = tables[0]
			expect(table.comments).toBeDefined()
			expect(table.comments.table).toBe('User accounts table')
			expect(table.comments.columns).toBeDefined()
			expect(table.comments.columns.id).toBe('Primary key')
			expect(table.comments.columns.name).toBe('User display name')
		})
	})

	describe('Complex Schema Extraction', () => {
		it('should extract schema with tables, views, and procedures', () => {
			const sql = `
        CREATE TABLE users (id int PRIMARY KEY, name varchar(100));
        CREATE INDEX idx_users_name ON users(name);
        CREATE VIEW active_users AS SELECT * FROM users WHERE is_active = true;
      `

			const schema = parser.extractSchema(sql)

			expect(schema).toBeDefined()
			expect(schema.tables).toBeInstanceOf(Array)
			expect(schema.tables.length).toBe(1)
			expect(schema.tables[0].name).toBe('users')

			expect(schema.indexes).toBeInstanceOf(Array)
			expect(schema.indexes.length).toBe(1)
			expect(schema.indexes[0].name).toBe('idx_users_name')

			expect(schema.views).toBeInstanceOf(Array)
			expect(schema.views.length).toBe(1)
			expect(schema.views[0].name).toBe('active_users')
		})
	})

	describe('Error Handling', () => {
		it('should handle malformed SQL gracefully', () => {
			// This SQL has a syntax error - missing comma
			const malformedSQL = `
        CREATE TABLE broken_table (
          id int PRIMARY KEY
          name varchar(30)
        );
      `

			// Our parser shouldn't throw but should return an empty array
			const ast = parser.parse(malformedSQL)
			expect(ast).toBeInstanceOf(Array)

			// The validateDDL utility should report the error
			const validation = parser.validateDDL(malformedSQL)
			expect(validation.valid).toBe(false)
			expect(validation.message).toBeDefined()
		})
	})
})
