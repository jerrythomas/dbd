// dbd/packages/parser/spec/view.spec.js
import { describe, it, expect, vi } from 'vitest'
import { gendersViewDDL, rangeValuesViewDDL } from './fixtures/ddl-samples.js'
import { SQLParser } from '../src/parser-utils.js'

describe('SQL Parser - View Definitions', () => {
	const parser = new SQLParser()

	describe('Basic View Parsing', () => {
		it.skip('should parse simple view definitions', () => {
			const sql = `
        CREATE VIEW simple_view AS 
        SELECT id, name FROM users;
      `
			const ast = parser.parse(sql)

			expect(ast).toBeInstanceOf(Array)
			expect(ast.length).toBeGreaterThan(0)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()
			expect(createViewStmt.view).toBe('simple_view')

			// Check select statement
			expect(createViewStmt.select).toBeDefined()
			expect(createViewStmt.select.type).toBe('select')
		})

		it.skip('should parse CREATE OR REPLACE VIEW', () => {
			const sql = `
        CREATE OR REPLACE VIEW test_view AS 
        SELECT * FROM products;
      `
			const ast = parser.parse(sql)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()
			expect(createViewStmt.replace).toBe(true)
		})

		it('should handle views with column aliases', () => {
			const sql = `
        CREATE VIEW user_details AS
        SELECT 
          u.id as user_id,
          u.name as full_name,
          u.email as contact_email
        FROM users u;
      `
			const ast = parser.parse(sql)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()

			const columns = createViewStmt.select.columns
			expect(columns.length).toBe(3)

			// Check column aliases
			expect(columns[0].as).toBe('user_id')
			expect(columns[1].as).toBe('full_name')
			expect(columns[2].as).toBe('contact_email')
		})
	})

	describe('Complex View Features', () => {
		it.skip('should parse views with JOINs', () => {
			const sql = `
        CREATE VIEW order_details AS
        SELECT 
          o.id as order_id,
          c.name as customer_name,
          p.name as product_name
        FROM orders o
        INNER JOIN customers c ON o.customer_id = c.id
        INNER JOIN order_items oi ON o.id = oi.order_id
        INNER JOIN products p ON oi.product_id = p.id;
      `
			const ast = parser.parse(sql)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()

			// Check JOINs
			const fromClause = createViewStmt.select.from
			expect(fromClause.length).toBe(1)

			const mainTable = fromClause[0]
			expect(mainTable.table).toBe('orders')
			expect(mainTable.as).toBe('o')

			// Check for joins
			expect(mainTable.join).toBeDefined()
			expect(mainTable.join.length).toBe(3)

			// Check first join
			expect(mainTable.join[0].type).toBe('INNER JOIN')
			expect(mainTable.join[0].table).toBe('customers')
			expect(mainTable.join[0].as).toBe('c')
		})

		it('should parse views with WHERE clauses', () => {
			const sql = `
        CREATE VIEW active_products AS
        SELECT id, name, price
        FROM products
        WHERE is_active = true AND price > 0;
      `
			const ast = parser.parse(sql)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()

			// Check WHERE clause
			expect(createViewStmt.select.where).toBeDefined()
			expect(createViewStmt.select.where.type).toBe('binary_expr')
			expect(createViewStmt.select.where.operator).toBe('AND')
		})

		it.skip('should parse views with GROUP BY and aggregates', () => {
			const sql = `
        CREATE VIEW product_stats AS
        SELECT 
          category_id,
          COUNT(*) as product_count,
          AVG(price) as avg_price
        FROM products
        GROUP BY category_id;
      `
			const ast = parser.parse(sql)

			const createViewStmt = ast.find((stmt) => stmt.type === 'create' && stmt.keyword === 'view')
			expect(createViewStmt).toBeDefined()

			// Check for aggregates
			const columns = createViewStmt.select.columns
			expect(columns.some((col) => col.expr.type === 'function' && col.expr.name === 'COUNT')).toBe(
				true
			)
			expect(columns.some((col) => col.expr.type === 'function' && col.expr.name === 'AVG')).toBe(
				true
			)

			// Check GROUP BY
			expect(createViewStmt.select.groupby).toBeDefined()
			expect(createViewStmt.select.groupby.length).toBe(1)
		})
	})

	describe('View Extraction', () => {
		it('should extract views using the extractViewDefinitions method', () => {
			const sql = `
        CREATE VIEW customer_orders AS
        SELECT c.id, c.name, COUNT(o.id) as order_count
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        GROUP BY c.id, c.name;
      `

			const views = parser.extractViewDefinitions(parser.parse(sql))

			expect(views).toBeInstanceOf(Array)
			expect(views.length).toBe(1)

			const view = views[0]
			expect(view.name).toBe('customer_orders')

			// Check columns
			expect(view.columns).toBeInstanceOf(Array)
			expect(view.columns.length).toBe(3)
			expect(view.columns[2].name).toBe('order_count')

			// Check dependencies
			expect(view.dependencies).toBeInstanceOf(Array)
			expect(view.dependencies.length).toBe(2)

			const tables = view.dependencies.map((d) => d.name)
			expect(tables).toContain('customers')
			expect(tables).toContain('orders')
		})

		it.skip('should handle views with JSON operators', () => {
			const sql = `
        CREATE VIEW product_details AS
        SELECT 
          id,
          name,
          metadata->>'manufacturer' as manufacturer,
          metadata->>'country' as country
        FROM products;
      `

			const views = parser.extractViewDefinitions(parser.parse(sql))

			expect(views.length).toBe(1)
			const view = views[0]

			// Check JSON extraction columns
			const manufacturerCol = view.columns.find((c) => c.name === 'manufacturer')
			expect(manufacturerCol).toBeDefined()
			expect(manufacturerCol.source.type).toBe('json_extract')
		})
	})

	describe('Schema Extraction with Views', () => {
		it('should include views in schema extraction', () => {
			const sql = `
        CREATE TABLE products (
          id int PRIMARY KEY,
          name varchar(100),
          price decimal(10,2)
        );
        
        CREATE VIEW expensive_products AS
        SELECT id, name, price
        FROM products
        WHERE price > 1000;
      `

			const schema = parser.extractSchema(sql)

			expect(schema.tables).toBeInstanceOf(Array)
			expect(schema.tables.length).toBe(1)

			expect(schema.views).toBeInstanceOf(Array)
			expect(schema.views.length).toBe(1)
			expect(schema.views[0].name).toBe('expensive_products')

			// Verify view dependencies
			expect(schema.views[0].dependencies[0].name).toBe('products')
		})
	})
})
