// dbd/packages/parser/spec/functional/views.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractViews,
	extractViewName,
	extractViewSchema,
	extractIsReplace,
	extractViewColumns,
	extractViewDependencies,
	extractViewDefinition,
	extractViewsFromSql
} from '../../../src/parser/extractors/views.js'

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

	describe('Additional coverage', () => {
		it('should use expr.name for column name', () => {
			const cols = extractViewColumns({
				select: {
					columns: [{ expr: { type: 'column_ref', name: 'computed_col' } }]
				}
			})
			expect(cols[0].name).toBe('computed_col')
		})

		it('should use [EXPRESSION] when no name available', () => {
			const cols = extractViewColumns({
				select: {
					columns: [{ expr: { type: 'expression' } }]
				}
			})
			expect(cols[0].name).toBe('[EXPRESSION]')
		})

		it('should handle JSONB operator column', () => {
			const cols = extractViewColumns({
				select: {
					columns: [
						{
							expr: {
								type: 'binary_expr',
								operator: '->',
								left: { column: 'data' },
								right: { value: 'key' }
							},
							as: 'val'
						}
					]
				}
			})
			expect(cols[0].source.type).toBe('json_extract')
			expect(cols[0].source.expression).toBe('data -> key')
		})

		it('should collect CTE names and exclude from dependencies', () => {
			const deps = extractViewDependencies({
				select: {
					with: [{ name: { value: 'cte_data' }, stmt: { from: [{ table: 'raw_data' }] } }],
					from: [{ table: 'cte_data' }, { table: 'other_table' }]
				}
			})
			expect(deps.some((d) => d.table === 'cte_data')).toBe(false)
			expect(deps.some((d) => d.table === 'other_table')).toBe(true)
			expect(deps.some((d) => d.table === 'raw_data')).toBe(true)
		})

		it('should extract definition from _original_sql', () => {
			const def = extractViewDefinition({
				view: 'my_view',
				select: { columns: [] },
				_original_sql: 'CREATE VIEW my_view AS SELECT id FROM users;'
			})
			expect(def).toBe('SELECT id FROM users')
		})

		it('should fallback to SELECT ... when no original SQL', () => {
			const def = extractViewDefinition({
				view: 'my_view',
				select: { columns: [] }
			})
			expect(def).toBe('SELECT ...')
		})

		it('should extract views from SQL string via extractViewsFromSql', () => {
			const views = extractViewsFromSql(
				'CREATE OR REPLACE VIEW staging.active_users AS SELECT id FROM users WHERE active;',
				'public'
			)
			expect(views.length).toBe(1)
			expect(views[0].name).toBe('active_users')
			expect(views[0].schema).toBe('staging')
			expect(views[0].replace).toBe(true)
			expect(views[0].definition).toContain('SELECT id FROM users')
		})

		it('should handle subquery in dependencies', () => {
			const deps = extractViewDependencies({
				select: {
					from: [{ table: 'users' }, { expr: { type: 'subquery' } }]
				}
			})
			expect(deps.length).toBe(2)
			expect(deps[0].table).toBe('users')
			expect(deps[1].type).toBe('subquery')
		})
	})

	describe('Branch coverage — remaining gaps', () => {
		it('extractViews returns empty for non-array ast', () => {
			expect(extractViews('not array')).toEqual([])
			expect(extractViews(null)).toEqual([])
		})

		it('extractViewName uses view.table fallback', () => {
			expect(extractViewName({ view: { table: 'my_view' } })).toBe('my_view')
		})

		it('extractViewName returns empty string for falsy view', () => {
			expect(extractViewName({ view: null })).toBe('')
			expect(extractViewName({})).toBe('')
		})

		it('extractViewColumns returns empty when no select', () => {
			expect(extractViewColumns({})).toEqual([])
			expect(extractViewColumns({ select: {} })).toEqual([])
		})

		it('extractViewColumns uses function name string fallback', () => {
			const cols = extractViewColumns({
				select: {
					columns: [
						{
							expr: { type: 'function', name: 'count' },
							as: 'cnt'
						}
					]
				}
			})
			expect(cols[0].source.name).toBe('count')
		})

		it('extractViewDependencies returns empty for no select or from', () => {
			expect(extractViewDependencies({})).toEqual([])
			expect(extractViewDependencies({ select: {} })).toEqual([])
		})

		it('extractViewDependencies handles CTE with string name', () => {
			const deps = extractViewDependencies({
				select: {
					with: [{ name: 'my_cte', stmt: { from: [{ table: 'raw' }] } }],
					from: [{ table: 'my_cte' }, { table: 'other' }]
				}
			})
			expect(deps.some((d) => d.table === 'my_cte')).toBe(false)
			expect(deps.some((d) => d.table === 'raw')).toBe(true)
			expect(deps.some((d) => d.table === 'other')).toBe(true)
		})

		it('extractViewDependencies uses table.name fallback via join', () => {
			const deps = extractViewDependencies({
				select: {
					from: [{ table: 'users' }, { join: { name: 'aliased_source', schema: 'app' } }]
				}
			})
			expect(deps).toHaveLength(2)
			expect(deps[0].table).toBe('users')
			expect(deps[1].table).toBe('aliased_source')
		})

		it('collectFromDeps handles non-array from gracefully', () => {
			// CTE with non-array from
			const deps = extractViewDependencies({
				select: {
					with: [{ name: { value: 'x' }, stmt: { from: 'not-array' } }],
					from: [{ table: 'users' }]
				}
			})
			expect(deps).toHaveLength(1)
			expect(deps[0].table).toBe('users')
		})

		it('extractViewsFromSql uses defaultSchema when no schema in SQL', () => {
			const views = extractViewsFromSql(
				'CREATE VIEW active_users AS SELECT id FROM users WHERE active;',
				'myschema'
			)
			expect(views[0].schema).toBe('myschema')
			expect(views[0].replace).toBe(false)
		})

		it('addViewDependency skips null/non-object table argument', () => {
			// Line 151: guard on addViewDependency — exercised via collectFromItems with bad join
			const deps = extractViewDependencies({
				select: {
					from: [{ join: null }]
				}
			})
			expect(deps).toHaveLength(0)
		})

		it('extractViewDependencies CTE with falsy name skips cteNames.add', () => {
			// Line 189: if (name) cteNames.add(name) — name falsy case
			const deps = extractViewDependencies({
				select: {
					with: [{ name: null, stmt: { from: [{ table: 'raw' }] } }],
					from: [{ table: 'raw' }]
				}
			})
			// raw is not excluded since CTE name was null
			expect(deps.some((d) => d.table === 'raw')).toBe(true)
		})

		it('extractViewDependencies CTE without stmt.from is skipped', () => {
			// Line 197: if (cte.stmt?.from) — cte without stmt
			const deps = extractViewDependencies({
				select: {
					with: [{ name: { value: 'my_cte' }, stmt: {} }],
					from: [{ table: 'other' }]
				}
			})
			expect(deps.some((d) => d.table === 'other')).toBe(true)
		})

		it('extractViewDefinition fallback when regex does not match', () => {
			// Line 218: if (match && match[2]) — no match
			const def = extractViewDefinition({
				view: 'some_view',
				select: { columns: [] },
				_original_sql: 'SELECT 1;'
			})
			expect(def).toBe('SELECT ...')
		})

		it('extractViewName falls through when view object has neither .view nor .table (line 64: false branch)', () => {
			// stmt.view is an object but has neither .view nor .table properties
			// → else if (stmt.view.table) is false → falls through to return stmt.view || ''
			const result = extractViewName({ view: { schema: 'public' } })
			// Falls through to line 68: return stmt.view || '' → returns the object
			expect(typeof result).toBe('object')
		})

		it('extractViewDependencies with addViewDependency called with null table (line 151)', () => {
			// The addViewDependency guard: !table (null) → return immediately
			// This happens via collectFromItems when item.join is null
			const deps = extractViewDependencies({
				select: {
					from: [
						{ table: 'users' },
						{ join: null, table: null } // join is null, but item.table is also null
					]
				}
			})
			// Only 'users' should appear since the null join is skipped
			expect(deps).toHaveLength(1)
			expect(deps[0].table).toBe('users')
		})
	})
})
