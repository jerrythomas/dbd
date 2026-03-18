// dbd/packages/parser/spec/functional/index.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractSchema,
	extractTableDefinitions,
	extractViewDefinitions,
	extractProcedureDefinitions,
	extractIndexDefinitions,
	validateDDL,
	identifyEntity,
	collectReferences
} from '../../../src/parser/index-functional.js'

describe('SQL Parser - Functional API - Complete Workflow', () => {
	const complexSQL = `
    -- Set the search path
    SET search_path TO app, public;

    -- Create tables
    CREATE TABLE categories (
      id serial PRIMARY KEY,
      name varchar(100) NOT NULL,
      parent_id int REFERENCES categories(id),
      created_at timestamp DEFAULT now()
    );

    CREATE TABLE products (
      id uuid PRIMARY KEY,
      name varchar(200) NOT NULL,
      description text,
      price numeric(10,2) NOT NULL,
      category_id int NOT NULL REFERENCES categories(id),
      is_active boolean DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp
    );

    -- Add comments
    COMMENT ON TABLE products IS 'Product catalog';
    COMMENT ON COLUMN products.id IS 'Unique product identifier';

    -- Create indexes
    CREATE UNIQUE INDEX idx_categories_name ON categories(name);
    CREATE INDEX idx_products_category ON products(category_id);

    -- Create view
    CREATE OR REPLACE VIEW active_products AS
    SELECT p.*, c.name as category_name
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = true;

    -- Create procedure
    CREATE OR REPLACE PROCEDURE update_product_timestamp(product_id uuid)
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE products
      SET updated_at = now()
      WHERE id = product_id;
    END;
    $$;
  `

	describe('extractSchema', () => {
		it('should extract a complete schema with all object types', () => {
			const schema = extractSchema(complexSQL)

			// Verify schema contains all object types
			expect(schema).toBeDefined()
			expect(schema.tables).toBeInstanceOf(Array)
			expect(schema.views).toBeInstanceOf(Array)
			expect(schema.procedures).toBeInstanceOf(Array)
			expect(schema.indexes).toBeInstanceOf(Array)

			// Verify counts
			expect(schema.tables.length).toBe(2)
			expect(schema.views.length).toBe(1)
			expect(schema.procedures.length).toBe(1)
			expect(schema.indexes.length).toBe(2)

			// Verify object names
			expect(schema.tables.map((t) => t.name)).toContain('categories')
			expect(schema.tables.map((t) => t.name)).toContain('products')
			expect(schema.views[0].name).toBe('active_products')
			expect(schema.procedures[0].name).toBe('update_product_timestamp')
			expect(schema.indexes.map((i) => i.name)).toContain('idx_categories_name')
		})
	})

	describe('Individual extractors', () => {
		it('should extract tables with extractTableDefinitions', () => {
			const tables = extractTableDefinitions(complexSQL)

			expect(tables.length).toBe(2)

			// Check categories table
			const categories = tables.find((t) => t.name === 'categories')
			expect(categories).toBeDefined()
			expect(categories.columns.length).toBe(4)
			expect(categories.columns[0].name).toBe('id')
			expect(categories.columns[0].dataType).toContain('serial')

			// Check products table
			const products = tables.find((t) => t.name === 'products')
			expect(products).toBeDefined()
			expect(products.columns.length).toBe(8)
			expect(products.comments.table).toBe('Product catalog')

			// Check for foreign key relationship
			const categoryIdCol = products.columns.find((c) => c.name === 'category_id')
			expect(categoryIdCol).toBeDefined()
			const fk = categoryIdCol.constraints.find((c) => c.type === 'FOREIGN KEY')
			expect(fk).toBeDefined()
			expect(fk.table).toBe('categories')
		})

		it('should extract views with extractViewDefinitions', () => {
			const views = extractViewDefinitions(complexSQL)

			expect(views.length).toBe(1)
			expect(views[0].name).toBe('active_products')
			expect(views[0].replace).toBe(true)

			// Check view dependencies
			const dependencies = views[0].dependencies
			expect(dependencies).toBeInstanceOf(Array)
			expect(dependencies.some((d) => d.table === 'products')).toBe(true)
			expect(dependencies.some((d) => d.table === 'categories')).toBe(true)
		})

		it('should extract procedures with extractProcedureDefinitions', () => {
			const procedures = extractProcedureDefinitions(complexSQL)

			expect(procedures.length).toBe(1)
			expect(procedures[0].name).toBe('update_product_timestamp')
			expect(procedures[0].language).toBe('plpgsql')

			// Check procedure parameters
			expect(procedures[0].parameters.length).toBe(1)
			expect(procedures[0].parameters[0].name).toBe('product_id')
			expect(procedures[0].parameters[0].dataType).toContain('uuid')

			// Check table references in procedure
			expect(procedures[0].tableReferences).toContain('products')
		})

		it('should extract indexes with extractIndexDefinitions', () => {
			const indexes = extractIndexDefinitions(complexSQL)

			expect(indexes.length).toBe(2)

			// Check unique index
			const uniqueIndex = indexes.find((i) => i.name === 'idx_categories_name')
			expect(uniqueIndex).toBeDefined()
			expect(uniqueIndex.unique).toBe(true)
			expect(uniqueIndex.table).toBe('categories')
			expect(uniqueIndex.columns[0].name).toBe('name')

			// Check regular index
			const regularIndex = indexes.find((i) => i.name === 'idx_products_category')
			expect(regularIndex).toBeDefined()
			expect(regularIndex.unique).toBe(false)
			expect(regularIndex.table).toBe('products')
			expect(regularIndex.columns[0].name).toBe('category_id')
		})
	})

	describe('Validation', () => {
		it('should validate valid SQL', () => {
			const result = validateDDL(complexSQL)
			expect(result.valid).toBe(true)
		})

		it('should invalidate incorrect SQL', () => {
			const invalidSQL = 'CREATE TABLE missing_paren (id int'
			const result = validateDDL(invalidSQL)

			expect(result.valid).toBe(false)
			expect(result.message).toContain('Error')
		})
	})
})

describe('identifyEntity — branch coverage', () => {
	it('returns null for null/non-array ast (line 124)', () => {
		expect(identifyEntity(null, '')).toBeNull()
		expect(identifyEntity('not-array', '')).toBeNull()
	})

	it('returns null when no create stmt found in ast', () => {
		const ast = [{ type: 'set', keyword: 'search_path' }]
		expect(identifyEntity(ast, '')).toBeNull()
	})

	it('returns null when table extractor returns null (line 88: info falsy)', () => {
		// stmt.table is undefined → extractTableEntity returns null
		const ast = [{ type: 'create', keyword: 'table', table: [] }]
		const result = identifyEntity(ast, '')
		// extractTableEntity(stmt) returns null when table[0] is undefined
		expect(result).toBeNull()
	})

	it('returns null when view extractor returns null (line 92)', () => {
		const ast = [{ type: 'create', keyword: 'view', view: null }]
		const result = identifyEntity(ast, '')
		expect(result).toBeNull()
	})

	it('handles procedure info as non-object string (line 101: truthy non-object branch)', () => {
		// info is a string (not object) → name: info, schema: null
		const ast = [{ type: 'create', keyword: 'procedure', procedure: 'my_proc' }]
		const result = identifyEntity(ast, '')
		expect(result).not.toBeNull()
		expect(result.name).toBe('my_proc')
		expect(result.schema).toBeNull()
	})

	it('returns null when procedure info is null (line 101: null return branch)', () => {
		// info is null/falsy → return null
		const ast = [{ type: 'create', keyword: 'procedure', procedure: null }]
		const result = identifyEntity(ast, '')
		expect(result).toBeNull()
	})

	it('uses SQL fallback for function when AST has no function keyword (line 136-143)', () => {
		// ast without function keyword → falls through to SQL regex match
		const ast = [{ type: 'set', keyword: 'search_path' }]
		const result = identifyEntity(ast, 'CREATE OR REPLACE FUNCTION public.my_func()')
		expect(result).not.toBeNull()
		expect(result.name).toBe('my_func')
		expect(result.schema).toBe('public')
		expect(result.type).toBe('function')
	})
})

describe('collectReferences — branch coverage', () => {
	it('collectTriggerRefs trigger without table skips table ref (line 192: false branch)', () => {
		// trigger.table is falsy — no table ref pushed
		const result = collectReferences({
			tables: [],
			views: [],
			procedures: [],
			triggers: [{ table: null, executeFunction: 'my_func' }]
		})
		const tableRef = result.find((r) => r.type === 'table')
		expect(tableRef).toBeUndefined()
		const funcRef = result.find((r) => r.type === 'function')
		expect(funcRef).toBeDefined()
		expect(funcRef.name).toBe('my_func')
	})

	it('collectTriggerRefs trigger without executeFunction skips function ref (line 198: false branch)', () => {
		// trigger.executeFunction is falsy — no function ref pushed
		const result = collectReferences({
			tables: [],
			views: [],
			procedures: [],
			triggers: [{ table: 'orders', tableSchema: 'public', executeFunction: null }]
		})
		const funcRef = result.find((r) => r.type === 'function')
		expect(funcRef).toBeUndefined()
		const tableRef = result.find((r) => r.type === 'table')
		expect(tableRef).toBeDefined()
		expect(tableRef.name).toBe('public.orders')
	})
})
