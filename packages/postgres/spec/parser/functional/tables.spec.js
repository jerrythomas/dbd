// dbd/packages/parser/spec/functional/tables.spec.js
import { describe, it, expect } from 'vitest'
import {
	extractTables,
	extractTableName,
	extractTableSchema,
	extractColumnsFromStatement,
	extractDataType,
	isNullable,
	extractDefaultValue,
	extractColumnConstraints,
	extractComments
} from '../../../src/parser/extractors/tables.js'

describe('Table Extractor - Functional API', () => {
	describe('extractTables', () => {
		it('should extract basic table definitions', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [
						{
							db: null,
							table: 'users',
							as: null
						}
					],
					create_definitions: [
						{
							column: {
								type: 'column_ref',
								table: null,
								column: {
									expr: {
										type: 'default',
										value: 'id'
									}
								}
							},
							definition: {
								dataType: 'INT'
							},
							resource: 'column',
							primary_key: 'primary key'
						},
						{
							column: {
								type: 'column_ref',
								table: null,
								column: {
									expr: {
										type: 'default',
										value: 'name'
									}
								}
							},
							definition: {
								dataType: 'VARCHAR',
								length: 100
							},
							resource: 'column',
							nullable: {
								type: 'not null',
								value: 'not null'
							}
						}
					]
				}
			]

			const tables = extractTables(ast)

			expect(tables).toBeInstanceOf(Array)
			expect(tables.length).toBe(1)

			const table = tables[0]
			expect(table.name).toBe('users')
			expect(table.columns.length).toBe(2)

			// Check specific columns
			const idCol = table.columns.find((c) => c.name === 'id')
			expect(idCol).toBeDefined()
			expect(idCol.dataType).toContain('int')
			expect(idCol.nullable).toBe(false)
			expect(idCol.constraints.some((c) => c.type === 'PRIMARY KEY')).toBe(true)

			const nameCol = table.columns.find((c) => c.name === 'name')
			expect(nameCol).toBeDefined()
			expect(nameCol.dataType).toContain('varchar')
			expect(nameCol.nullable).toBe(false)
		})

		it('should handle tables with foreign keys', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'categories' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' },
							primary_key: 'primary key'
						}
					]
				},
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'products' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' },
							primary_key: 'primary key'
						},
						{
							column: { column: { expr: { value: 'category_id' } } },
							definition: { dataType: 'INT' },
							reference_definition: {
								table: [{ table: 'categories' }],
								definition: [{ column: { expr: { value: 'id' } } }]
							}
						}
					]
				}
			]

			const tables = extractTables(ast)

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
			expect(fkConstraint.column).toBe('id')
		})

		it('should handle tables with comments', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'users' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' },
							primary_key: 'primary key'
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: {
						type: 'table',
						name: { table: 'users' }
					},
					expr: {
						expr: { value: 'User accounts table' }
					}
				},
				{
					type: 'comment',
					keyword: 'on',
					target: {
						type: 'column',
						name: {
							table: 'users',
							column: { expr: { value: 'id' } }
						}
					},
					expr: {
						expr: { value: 'Primary key' }
					}
				}
			]

			const tables = extractTables(ast)

			expect(tables.length).toBe(1)

			const table = tables[0]
			expect(table.comments).toBeDefined()
			expect(table.comments.table).toBe('User accounts table')
			expect(table.comments.columns).toBeDefined()
			expect(table.comments.columns.id).toBe('Primary key')
		})

		it('should handle search_path schema', () => {
			const ast = [
				{
					type: 'set',
					variable: 'search_path',
					value: ['my_schema']
				},
				{
					type: 'create',
					keyword: 'table',
					table: [
						{
							table: 'users',
							schema: null
						}
					],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' },
							primary_key: 'primary key'
						}
					]
				}
			]

			const tables = extractTables(ast)

			expect(tables.length).toBe(1)
			expect(tables[0].schema).toBe('my_schema')
		})
	})

	describe('extractTableName', () => {
		it('handles string table name', () => {
			expect(extractTableName({ table: 'public.users' })).toBe('users')
		})

		it('handles simple string table name without schema', () => {
			expect(extractTableName({ table: 'users' })).toBe('users')
		})

		it('handles object table name', () => {
			expect(extractTableName({ table: { table: 'orders' } })).toBe('orders')
		})

		it('returns empty string for missing table', () => {
			expect(extractTableName({})).toBe('')
		})
	})

	describe('extractTableSchema', () => {
		it('handles string table with schema', () => {
			expect(extractTableSchema({ table: 'myschema.users' })).toBe('myschema')
		})

		it('returns null for string table without schema', () => {
			expect(extractTableSchema({ table: 'users' })).toBeNull()
		})

		it('handles object table with schema', () => {
			expect(extractTableSchema({ table: { schema: 'config' } })).toBe('config')
		})

		it('handles object table with db as schema', () => {
			expect(extractTableSchema({ table: { db: 'staging' } })).toBe('staging')
		})

		it('returns null for missing table', () => {
			expect(extractTableSchema({})).toBeNull()
		})
	})

	describe('extractColumnsFromStatement', () => {
		it('returns empty for no create_definitions', () => {
			expect(extractColumnsFromStatement({})).toEqual([])
		})

		it('handles ColumnDef format', () => {
			const stmt = {
				create_definitions: [
					{
						column: true,
						ColumnDef: {
							colname: 'age',
							definition: { dataType: 'INT' }
						}
					}
				]
			}
			const cols = extractColumnsFromStatement(stmt)
			expect(cols).toHaveLength(1)
			expect(cols[0].name).toBe('age')
		})

		it('handles column.column string format', () => {
			const stmt = {
				create_definitions: [
					{
						column: { column: 'status' },
						definition: { dataType: 'TEXT' }
					}
				]
			}
			const cols = extractColumnsFromStatement(stmt)
			expect(cols).toHaveLength(1)
			expect(cols[0].name).toBe('status')
		})
	})

	describe('Column extraction utilities', () => {
		it('should extract column data types correctly', () => {
			const columnDef = {
				definition: {
					dataType: 'VARCHAR',
					length: 100
				}
			}

			expect(extractDataType(columnDef)).toBe('varchar(100)')
		})

		it('should determine nullability correctly', () => {
			const notNullColumn = {
				nullable: { type: 'not null' }
			}

			const nullableColumn = {}

			const primaryKeyColumn = {
				primary_key: 'primary key'
			}

			expect(isNullable(notNullColumn)).toBe(false)
			expect(isNullable(nullableColumn)).toBe(true)
			expect(isNullable(primaryKeyColumn)).toBe(false)
		})

		it('should extract default values correctly', () => {
			const withStringDefault = {
				default_val: {
					type: 'default',
					value: 'test'
				}
			}

			const withFunctionDefault = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: {
							name: [{ value: 'now' }]
						},
						args: {
							value: []
						}
					}
				}
			}

			expect(extractDefaultValue(withStringDefault)).toBe('test')
			expect(extractDefaultValue(withFunctionDefault)).toBe('now()')
		})

		it('should extract column constraints correctly', () => {
			const withPrimaryKey = {
				primary_key: 'primary key'
			}

			const withForeignKey = {
				reference_definition: {
					table: [{ table: 'users' }],
					definition: [{ column: { expr: { value: 'id' } } }]
				}
			}

			const pkConstraints = extractColumnConstraints(withPrimaryKey)
			expect(pkConstraints.length).toBe(1)
			expect(pkConstraints[0].type).toBe('PRIMARY KEY')

			const fkConstraints = extractColumnConstraints(withForeignKey)
			expect(fkConstraints.length).toBe(1)
			expect(fkConstraints[0].type).toBe('FOREIGN KEY')
			expect(fkConstraints[0].table).toBe('users')
			expect(fkConstraints[0].column).toBe('id')
		})

		it('extracts PK from constraints array (CONSTR_PRIMARY)', () => {
			const col = {
				constraints: [{ Constraint: { contype: 'CONSTR_PRIMARY' } }]
			}
			const result = extractColumnConstraints(col)
			expect(result).toEqual([{ type: 'PRIMARY KEY' }])
		})

		it('extracts PK from constraints array (type string)', () => {
			const col = {
				constraints: [{ type: 'primary key' }]
			}
			const result = extractColumnConstraints(col)
			expect(result).toEqual([{ type: 'PRIMARY KEY' }])
		})

		it('extracts FK from constraints array (CONSTR_FOREIGN)', () => {
			const col = {
				constraints: [
					{
						Constraint: {
							contype: 'CONSTR_FOREIGN',
							pktable: { relname: 'orders', schemaname: 'public' },
							pk_attrs: [{ String: { str: 'order_id' } }]
						}
					}
				]
			}
			const result = extractColumnConstraints(col)
			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				type: 'FOREIGN KEY',
				table: 'orders',
				schema: 'public',
				column: 'order_id'
			})
		})

		it('returns all FK constraints when constraints array has multiple normalized FKs', () => {
			const col = {
				constraints: [
					{
						type: 'FOREIGN KEY',
						table: 'tenants',
						schema: 'core',
						column: 'id'
					},
					{
						type: 'FOREIGN KEY',
						table: 'region_levels',
						schema: null,
						column: 'id'
					}
				],
				reference_definition: {
					table: [{ table: 'region_levels', schema: null }],
					definition: [{ column: { expr: { value: 'id' } } }]
				}
			}
			const result = extractColumnConstraints(col)
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: 'FOREIGN KEY',
				table: 'tenants',
				schema: 'core',
				column: 'id'
			})
			expect(result[1]).toEqual({
				type: 'FOREIGN KEY',
				table: 'region_levels',
				schema: null,
				column: 'id'
			})
		})

		it('extracts FK with column string fallback in reference_definition', () => {
			const col = {
				reference_definition: {
					table: [{ table: 'roles' }],
					definition: [{ column: 'role_id' }]
				}
			}
			const result = extractColumnConstraints(col)
			expect(result[0].column).toBe('role_id')
		})

		it('isNullable returns false for CONSTR_NOTNULL constraint', () => {
			const col = {
				constraints: [{ Constraint: { contype: 'CONSTR_NOTNULL' } }]
			}
			expect(isNullable(col)).toBe(false)
		})

		it('isNullable returns false for "not null" type constraint', () => {
			const col = {
				constraints: [{ type: 'not null' }]
			}
			expect(isNullable(col)).toBe(false)
		})

		it('isNullable returns false for nullable.not', () => {
			expect(isNullable({ nullable: { not: true } })).toBe(false)
		})

		it('extractDataType handles typeName with typmods', () => {
			const col = {
				typeName: {
					names: [{ String: { str: 'numeric' } }],
					typmods: [
						{ A_Const: { val: { Integer: { ival: 10 } } } },
						{ A_Const: { val: { Integer: { ival: 2 } } } }
					]
				}
			}
			expect(extractDataType(col)).toBe('numeric(10, 2)')
		})

		it('extractDataType returns null for missing definition', () => {
			expect(extractDataType({})).toBeNull()
		})

		it('extractDataType handles length as object with value', () => {
			const col = {
				definition: { dataType: 'VARCHAR', length: { value: 255 } }
			}
			expect(extractDataType(col)).toBe('varchar(255)')
		})

		it('extractDefaultValue handles direct string default_val', () => {
			expect(extractDefaultValue({ default_val: 'hello' })).toBe('hello')
		})

		it('extractDefaultValue returns null for null input', () => {
			expect(extractDefaultValue(null)).toBeNull()
		})
	})

	describe('extractComments edge cases', () => {
		it('handles string target names for table comments', () => {
			const ast = [
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: 'config.lookups' },
					expr: { value: 'Lookup values' }
				}
			]
			const tables = extractTables(ast)
			// No tables to match, but extractComments should parse without error
			expect(tables).toEqual([])
		})

		it('handles string target names for column comments with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ db: 'hr', table: 'employees' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'name' } } },
							definition: { dataType: 'TEXT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'column', name: 'hr.employees.name' },
					expr: { value: 'Employee full name' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].comment).toBe('Employee full name')
		})

		it('handles object-structured table comment name with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ db: 'config', table: 'lookups' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: {
						type: 'table',
						name: { table: 'lookups', schema: 'config' }
					},
					expr: { value: 'Lookup definitions' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].comments.table).toBe('Lookup definitions')
		})

		it('handles object-structured column comment name with schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ db: 'hr', table: 'employees' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'name' } } },
							definition: { dataType: 'TEXT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: {
						type: 'column',
						name: {
							table: 'employees',
							schema: 'hr',
							column: { expr: { value: 'name' } }
						}
					},
					expr: { value: 'Employee full name (object)' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].comment).toBe('Employee full name (object)')
		})

		it('handles column comment with string column name (not expr object)', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'items' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'status' } } },
							definition: { dataType: 'TEXT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: {
						type: 'column',
						name: { table: 'items', column: 'status' }
					},
					expr: { value: 'Item status' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].comment).toBe('Item status')
		})

		it('handles column comment with two-part string name (table.column)', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'orders' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'total' } } },
							definition: { dataType: 'NUMERIC' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'column', name: 'orders.total' },
					expr: { value: 'Order total amount' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].comment).toBe('Order total amount')
		})

		it('handles column comment with plain string expr', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'items' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'code' } } },
							definition: { dataType: 'TEXT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'column', name: 'items.code' },
					expr: 'Item code identifier'
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].comment).toBe('Item code identifier')
		})

		it('handles column comment with single-part string name', () => {
			const ast = [
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'column', name: 'justcolumn' },
					expr: { value: 'Orphan column comment' }
				}
			]
			const tables = extractTables(ast)
			expect(tables).toEqual([])
		})

		it('handles table comment with db property instead of schema', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ db: 'myschema', table: 'mytable' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: { table: 'mytable', db: 'myschema' } },
					expr: { expr: { value: 'Table with db qualifier' } }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].comments.table).toBe('Table with db qualifier')
		})

		it('extracts column name from colname fallback', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'items' }],
					create_definitions: [
						{
							column: true,
							colname: 'status',
							definition: { dataType: 'TEXT' }
						}
					]
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].columns[0].name).toBe('status')
		})

		it('extracts default value from function with args', () => {
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: [{ value: 'substr' }] },
						args: { value: [{ value: 'hello' }, { value: '1' }] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('substr(hello, 1)')
		})

		it('handles expr as plain string', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'items' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: { table: 'items' } },
					expr: 'A simple items table'
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].comments.table).toBe('A simple items table')
		})
	})

	describe('Branch coverage — remaining gaps', () => {
		it('extractTables returns empty for non-array ast', () => {
			expect(extractTables('not array')).toEqual([])
			expect(extractTables(null)).toEqual([])
		})

		it('extractColumnsFromStatement filters out rows without column or ColumnDef', () => {
			const stmt = {
				create_definitions: [
					{
						column: { column: { expr: { value: 'id' } } },
						definition: { dataType: 'INT' }
					},
					{ resource: 'constraint', type: 'primary key' }
				]
			}
			const cols = extractColumnsFromStatement(stmt)
			expect(cols).toHaveLength(1)
			expect(cols[0].name).toBe('id')
		})

		it('isNullable returns false for nullable.value "not null"', () => {
			expect(isNullable({ nullable: { value: 'not null' } })).toBe(false)
		})

		it('isNullable returns false when PK detected via extractColumnConstraints', () => {
			// Column with no primary_key flag but has CONSTR_PRIMARY in constraints
			const col = {
				constraints: [{ Constraint: { contype: 'CONSTR_PRIMARY' } }]
			}
			expect(isNullable(col)).toBe(false)
		})

		it('extractDefaultValue handles function name as plain string', () => {
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: 'gen_random_uuid',
						args: { value: [] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('gen_random_uuid()')
		})

		it('extractDefaultValue handles function with no args', () => {
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: [{ value: 'now' }] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('now()')
		})

		it('extractDefaultValue handles function arg with no value', () => {
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: [{ value: 'coalesce' }] },
						args: { value: [{ type: 'expr' }] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('coalesce()')
		})

		it('extractColumnConstraints FK with no pk_attrs falls back to id', () => {
			const col = {
				constraints: [
					{
						Constraint: {
							contype: 'CONSTR_FOREIGN',
							pktable: { relname: 'users', schemaname: 'public' }
						}
					}
				]
			}
			const result = extractColumnConstraints(col)
			expect(result[0].column).toBe('id')
		})

		it('extractComments returns default for non-array ast', () => {
			expect(extractComments(null)).toEqual({ tables: {}, columns: {} })
			expect(extractComments('not array')).toEqual({ tables: {}, columns: {} })
		})

		it('table comment with single-part string name (no schema)', () => {
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'items' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: 'items' },
					expr: { value: 'Single-name table comment' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].comments.table).toBe('Single-name table comment')
		})

		it('extractDataType returns null for falsy def (definition missing, columnDef falsy)', () => {
			expect(extractDataType(false)).toBeNull()
			expect(extractDataType(0)).toBeNull()
		})

		it('resolveCommentValue returns null when expr has no recognizable format', () => {
			// Line 353: return null — expr is an object with no expr.value, .value, or string
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'things' }],
					create_definitions: [
						{
							column: { column: { expr: { value: 'id' } } },
							definition: { dataType: 'INT' }
						}
					]
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: { table: 'things' } },
					expr: { someOtherProp: 42 }
				}
			]
			const tables = extractTables(ast)
			// Comment with null value should not be stored (returns null, not set to key)
			expect(tables[0].comments.table).toBeFalsy()
		})

		it('extractDefaultValue uses array map+join when name.name[0].value is falsy', () => {
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: ['pg_catalog', 'nextval'] },
						args: { value: [] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('pg_catalog.nextval()')
		})

		it('extractComments handles comment with unknown target type (line 427: false branch)', () => {
			// target.type is neither 'table' nor 'column' — skipped
			const ast = [
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'schema', name: 'public' },
					expr: { value: 'My schema' }
				}
			]
			const result = extractComments(ast)
			expect(result).toEqual({ tables: {}, columns: {} })
		})

		it('processTableComments handles table with no columns (line 459: false branch)', () => {
			// A table with no columns — updatedTable.columns is empty array
			const ast = [
				{
					type: 'create',
					keyword: 'table',
					table: [{ table: 'empty_table' }],
					create_definitions: []
				},
				{
					type: 'comment',
					keyword: 'on',
					target: { type: 'table', name: { table: 'empty_table' } },
					expr: { value: 'An empty table' }
				}
			]
			const tables = extractTables(ast)
			expect(tables[0].comments.table).toBe('An empty table')
			expect(tables[0].columns).toHaveLength(0)
		})

		it('extractFKFromRefDef uses column string fallback (line 280: || column)', () => {
			// ref.definition[0].column is a string, not object with .expr.value
			const col = {
				reference_definition: {
					table: [{ table: 'users', schema: null }],
					definition: [{ column: 'user_id' }]
				}
			}
			const result = extractColumnConstraints(col)
			expect(result[0].column).toBe('user_id')
		})

		it('extractFKFromRefDef falls back to id when no column info (line 280: || id)', () => {
			// ref.definition[0].column is undefined — falls back to 'id'
			const col = {
				reference_definition: {
					table: [{ table: 'roles', schema: null }],
					definition: [{}]
				}
			}
			const result = extractColumnConstraints(col)
			expect(result[0].column).toBe('id')
		})

		it('extractDataType handles typmods where all values are undefined (line 185: false branch)', () => {
			// typmods contains items where A_Const?.val?.Integer?.ival is undefined
			// → filter returns empty → length === 0 → no type spec appended
			const col = {
				typeName: {
					names: [{ String: { str: 'text' } }],
					typmods: [{ A_Const: { val: { String: { str: 'foo' } } } }] // no Integer
				}
			}
			const result = extractDataType(col)
			// Should not have parentheses since all typmods filtered out
			expect(result).not.toContain('(')
		})

		it('extractDefaultValue function arg with no value returns empty string (line 257/259)', () => {
			// arg is an object with no .value — returns ''
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: [{ value: 'coalesce' }] },
						args: { value: [{ type: 'column_ref' }] } // arg is object without .value
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('coalesce()')
		})

		it('extractDefaultValue returns null when default_val has unknown type (line 241: false)', () => {
			// defaultExpr.type is not 'default' — falls through to return null
			const col = { default_val: { type: 'expression', expr: 'something' } }
			expect(extractDefaultValue(col)).toBeNull()
		})

		it('extractDefaultValue handles string arg in function args (line 257: true branch)', () => {
			// arg is a plain string — returns arg directly
			const col = {
				default_val: {
					type: 'default',
					value: {
						type: 'function',
						name: { name: [{ value: 'format' }] },
						args: { value: ['hello', 'world'] }
					}
				}
			}
			expect(extractDefaultValue(col)).toBe('format(hello, world)')
		})
	})
})
