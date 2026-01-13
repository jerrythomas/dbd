// dbd/packages/parser/spec/functional/views.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractViews,
	extractViewName,
	extractViewSchema,
	extractIsReplace,
	extractViewColumns,
	extractViewDependencies,
	extractViewDefinition
} from '../../src/extractors/views.js'

describe('View Extractor - Functional API', () => {
	describe('extractViews', () => {
		it('should extract basic view definitions', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'view',
					view: 'simple_view',
					replace: false,
					select: {
						type: 'select',
						columns: [
							{
								expr: {
									type: 'column_ref',
									table: 'users',
									column: 'id'
								}
							},
							{
								expr: {
									type: 'column_ref',
									table: 'users',
									column: 'name'
								}
							}
						],
						from: [
							{
								table: 'users'
							}
						]
					}
				}
			]

			const views = extractViews(ast)

			expect(views).toBeInstanceOf(Array)
			expect(views.length).toBe(1)

			const view = views[0]
			expect(view.name).toBe('simple_view')
			expect(view.columns.length).toBe(2)
			expect(view.dependencies.length).toBe(1)
			expect(view.dependencies[0].table).toBe('users')
		})

		it('should handle OR REPLACE views', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'view',
					view: 'test_view',
					replace: 'or replace',
					select: {
						type: 'select',
						columns: [{ expr: { type: 'star' } }],
						from: [{ table: 'products' }]
					}
				}
			]

			const views = extractViews(ast)

			expect(views.length).toBe(1)
			expect(views[0].replace).toBe(true)
		})

		it('should handle views with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'view',
					view: {
						view: 'analytics_view',
						schema: 'reporting'
					},
					select: {
						type: 'select',
						columns: [{ expr: { type: 'star' } }],
						from: [{ table: 'data' }]
					}
				}
			]

			const views = extractViews(ast)

			expect(views.length).toBe(1)
			expect(views[0].name).toBe('analytics_view')
			expect(views[0].schema).toBe('reporting')
		})

		it('should fallback to regex extraction when AST extraction fails', () => {
			const ast = []
			ast._original_sql = `
        CREATE OR REPLACE VIEW reporting.user_stats AS
        SELECT user_id, count(*) as login_count
        FROM logins
        GROUP BY user_id;
      `

			const views = extractViews(ast)

			expect(views.length).toBe(1)
			expect(views[0].name).toBe('user_stats')
			expect(views[0].schema).toBe('reporting')
			expect(views[0].replace).toBe(true)
			expect(views[0].definition).toContain('SELECT user_id')
		})
	})

	describe('Component extraction utilities', () => {
		it('should extract view names correctly', () => {
			expect(extractViewName({ view: 'simple_view' })).toBe('simple_view')
			expect(extractViewName({ view: { view: 'complex_view', schema: 'app' } })).toBe(
				'complex_view'
			)
		})

		it('should extract view schemas correctly', () => {
			expect(extractViewSchema({ view: 'simple_view' })).toBeNull()
			expect(extractViewSchema({ view: { view: 'complex_view', schema: 'app' } })).toBe('app')
			expect(extractViewSchema({ view: 'view', schema: 'public' })).toBe('public')
		})

		it('should detect CREATE OR REPLACE correctly', () => {
			expect(extractIsReplace({ replace: 'or replace' })).toBe(true)
			expect(extractIsReplace({ replace: false })).toBe(false)
			expect(extractIsReplace({ or_replace: true })).toBe(true)
			expect(extractIsReplace({})).toBe(false)
		})

		it('should extract view columns correctly', () => {
			const stmt = {
				select: {
					columns: [
						{
							expr: {
								type: 'column_ref',
								table: 'users',
								column: 'id'
							},
							as: 'user_id'
						},
						{
							expr: {
								type: 'function',
								name: {
									name: [{ value: 'count' }]
								}
							},
							as: 'total'
						}
					]
				}
			}

			const columns = extractViewColumns(stmt)

			expect(columns.length).toBe(2)
			expect(columns[0].name).toBe('user_id')
			expect(columns[0].source.table).toBe('users')
			expect(columns[0].source.column).toBe('id')
			expect(columns[1].name).toBe('total')
			expect(columns[1].source.type).toBe('function')
		})

		it('should extract view dependencies correctly', () => {
			const stmt = {
				select: {
					from: [
						{ table: 'users' },
						{
							join: { table: 'orders' },
							on: { type: 'binary_expr' }
						}
					]
				}
			}

			const dependencies = extractViewDependencies(stmt)

			expect(dependencies.length).toBe(2)
			expect(dependencies[0].table).toBe('users')
			expect(dependencies[1].table).toBe('orders')
		})
	})
})
