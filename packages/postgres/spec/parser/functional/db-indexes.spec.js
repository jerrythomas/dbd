// dbd/packages/parser/spec/functional/db-indexes.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractIndexes,
	extractIndexName,
	extractIndexSchema,
	extractTableName,
	extractTableSchema,
	extractIndexColumns,
	extractIndexesFromSql
} from '../../../src/parser/extractors/db-indexes.js'

describe('Database Index Extractor - Functional API', () => {
	describe('extractIndexes', () => {
		it('should extract basic index definitions', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					index: {
						name: 'idx_users_email'
					},
					table: {
						table: 'users',
						schema: null
					},
					columns: [
						{
							column: {
								column: {
									expr: {
										type: 'default',
										value: 'email'
									}
								}
							}
						}
					]
				}
			]

			const indexes = extractIndexes(ast)

			expect(indexes).toBeInstanceOf(Array)
			expect(indexes.length).toBe(1)

			const index = indexes[0]
			expect(index.name).toBe('idx_users_email')
			expect(index.table).toBe('users')
			expect(index.columns.length).toBe(1)
			expect(index.columns[0].name).toBe('email')
		})

		it('should handle UNIQUE indexes', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					unique: true,
					index: {
						name: 'idx_unique_email'
					},
					table: {
						table: 'users'
					},
					columns: [
						{
							column: {
								column: 'email'
							}
						}
					]
				}
			]

			const indexes = extractIndexes(ast)

			expect(indexes.length).toBe(1)
			expect(indexes[0].unique).toBe(true)
		})

		it('should handle indexes with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					index: {
						name: 'idx_products_name',
						schema: 'shop'
					},
					table: {
						table: 'products',
						schema: 'shop'
					},
					columns: [
						{
							name: 'name',
							order: 'ASC'
						}
					]
				}
			]

			const indexes = extractIndexes(ast)

			expect(indexes.length).toBe(1)
			expect(indexes[0].name).toBe('idx_products_name')
			expect(indexes[0].schema).toBe('shop')
			expect(indexes[0].tableSchema).toBe('shop')
		})

		it('should handle multi-column indexes with ordering', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					index: {
						name: 'idx_orders_customer_date'
					},
					table: {
						table: 'orders'
					},
					columns: [
						{
							column: {
								column: {
									expr: {
										value: 'customer_id'
									}
								}
							}
						},
						{
							column: {
								column: {
									expr: {
										value: 'order_date'
									}
								}
							},
							order: 'DESC'
						}
					]
				}
			]

			const indexes = extractIndexes(ast)

			expect(indexes.length).toBe(1)
			expect(indexes[0].columns.length).toBe(2)
			expect(indexes[0].columns[0].name).toBe('customer_id')
			expect(indexes[0].columns[0].order).toBe('ASC') // Default
			expect(indexes[0].columns[1].name).toBe('order_date')
			expect(indexes[0].columns[1].order).toBe('DESC')
		})

		it('should fallback to regex extraction when AST extraction fails', () => {
			const ast = []
			ast._original_sql = `
        CREATE UNIQUE INDEX idx_users_username ON users (username);
        CREATE INDEX idx_posts_title ON blog.posts (title, created_at DESC);
      `

			const indexes = extractIndexes(ast)

			expect(indexes.length).toBe(2)
			expect(indexes[0].name).toBe('idx_users_username')
			expect(indexes[0].unique).toBe(true)
			expect(indexes[1].name).toBe('idx_posts_title')
			expect(indexes[1].table).toBe('posts')
			expect(indexes[1].tableSchema).toBe('blog')
			expect(indexes[1].columns.length).toBe(2)
			expect(indexes[1].columns[1].order).toBe('DESC')
		})
	})

	describe('Component extraction utilities', () => {
		it('should extract index names correctly', () => {
			expect(extractIndexName({ index: { name: 'idx_test' } })).toBe('idx_test')
			expect(extractIndexName({ IndexName: 'idx_alt' })).toBe('idx_alt')
			expect(extractIndexName({ indexname: 'idx_another' })).toBe('idx_another')
		})

		it('should extract index schemas correctly', () => {
			expect(extractIndexSchema({ index: { schema: 'app' } })).toBe('app')
			expect(extractIndexSchema({ schema: 'public' })).toBe('public')
			expect(extractIndexSchema({})).toBeNull()
		})

		it('should extract table names correctly', () => {
			expect(extractTableName({ table: { table: 'users' } })).toBe('users')
			expect(extractTableName({ table_name: [{ table: 'accounts' }] })).toBe('accounts')
			expect(extractTableName({ relationName: 'products' })).toBe('products')
		})

		it('should extract table schemas correctly', () => {
			expect(extractTableSchema({ table: { schema: 'app' } })).toBe('app')
			expect(extractTableSchema({ table_name: [{ schema: 'public' }] })).toBe('public')
			expect(extractTableSchema({})).toBeNull()
		})

		it('should extract index columns correctly', () => {
			const stmt = {
				columns: [
					{
						column: { column: { expr: { value: 'name' } } }
					},
					{
						name: 'age',
						order: 'desc'
					}
				]
			}

			const columns = extractIndexColumns(stmt)

			expect(columns.length).toBe(2)
			expect(columns[0].name).toBe('name')
			expect(columns[0].order).toBe('ASC')
			expect(columns[1].name).toBe('age')
			expect(columns[1].order).toBe('DESC')
		})
	})

	describe('SQL text extraction', () => {
		it('should extract indexes from SQL text', () => {
			const sql = `
        CREATE UNIQUE INDEX idx_users_email ON users (email);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status, created_at DESC);
      `

			const indexes = extractIndexesFromSql(sql, 'public')

			expect(indexes.length).toBe(2)
			expect(indexes[0].name).toBe('idx_users_email')
			expect(indexes[0].unique).toBe(true)
			expect(indexes[1].name).toBe('idx_orders_status')
			expect(indexes[1].ifNotExists).toBe(true)
			expect(indexes[1].columns.length).toBe(2)
			expect(indexes[1].columns[0].name).toBe('status')
			expect(indexes[1].columns[1].name).toBe('created_at')
			expect(indexes[1].columns[1].order).toBe('DESC')
		})
	})

	describe('extractIndexes — edge cases', () => {
		it('returns empty array for null ast', () => {
			expect(extractIndexes(null)).toEqual([])
		})

		it('returns empty array for non-array ast', () => {
			expect(extractIndexes('not an array')).toEqual([])
		})
	})

	describe('extractTableName — alternate shapes', () => {
		it('extracts table name from on[0].table', () => {
			expect(extractTableName({ on: [{ table: 'products' }] })).toBe('products')
		})

		it('extracts table name as direct string', () => {
			expect(extractTableName({ table: 'orders' })).toBe('orders')
		})

		it('returns null when no recognizable table format', () => {
			expect(extractTableName({})).toBeNull()
		})
	})

	describe('Additional coverage — alternate AST shapes', () => {
		it('should correct unique flag from _original_sql', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					unique: false,
					index: { name: 'idx_email' },
					table: { table: 'users' },
					columns: [{ column: { column: { expr: { value: 'email' } } } }]
				}
			]
			ast._original_sql = 'CREATE UNIQUE INDEX idx_email ON users (email);'

			const indexes = extractIndexes(ast)
			expect(indexes[0].unique).toBe(true)
		})

		it('should extract index name as direct string', () => {
			expect(extractIndexName({ index: 'idx_direct' })).toBe('idx_direct')
		})

		it('should extract index name from object with value', () => {
			expect(extractIndexName({ index: { value: 'idx_val' } })).toBe('idx_val')
		})

		it('should return null for index object with no name or value', () => {
			expect(extractIndexName({ index: { something: 'else' } })).toBeNull()
		})

		it('should extract table name as direct string', () => {
			expect(extractTableName({ table: 'my_table' })).toBe('my_table')
		})

		it('should handle column with direction property', () => {
			const stmt = {
				columns: [{ name: 'created_at', direction: 'desc' }]
			}
			const cols = extractIndexColumns(stmt)
			expect(cols[0].order).toBe('DESC')
		})

		it('should handle column with expr.column path', () => {
			const stmt = {
				columns: [{ expr: { column: 'email' } }]
			}
			const cols = extractIndexColumns(stmt)
			expect(cols[0].name).toBe('email')
		})

		it('should return empty array for non-array columns', () => {
			expect(extractIndexColumns({ columns: 'not-an-array' })).toEqual([])
			expect(extractIndexColumns({ columns: null })).toEqual([])
			expect(extractIndexColumns({})).toEqual([])
		})

		it('should prefer SQL indexes over AST when _original_sql exists', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'index',
					index: { name: 'idx_ast' },
					table: { table: 'users' },
					columns: [{ column: { column: { expr: { value: 'id' } } } }]
				}
			]
			ast._original_sql = 'CREATE INDEX idx_sql ON users (email);'

			const indexes = extractIndexes(ast)
			expect(indexes[0].name).toBe('idx_sql')
		})
	})
})
