/**
 * Tests for parser translator functions — targets uncovered branches.
 */
import { describe, it, expect } from 'vitest'
import {
	translateColumnDef,
	translateTableConstraint,
	translateCreateStmt
} from '../../src/parser/translators/create-table.js'
import { translateCreateTrigStmt } from '../../src/parser/translators/create-trigger.js'
import { translateCreateFunctionStmt } from '../../src/parser/translators/create-function.js'
import { resolveTypeName, resolveDefaultExpr } from '../../src/parser/translators/types.js'
import { translateWhereExpr } from '../../src/parser/translators/where-expr.js'

// ─── create-table.js ─────────────────────────────────────────────────────────

describe('create-table translator', () => {
	describe('translateColumnConstraints — unknown constraint type', () => {
		it('skips constraints with unrecognised contype (line 52: if (handler))', () => {
			// Arrange: a ColumnDef with an unknown constraint type
			const colDef = {
				ColumnDef: {
					colname: 'status',
					typeName: {
						names: [{ String: { sval: 'text' } }]
					},
					constraints: [
						{
							Constraint: {
								contype: 'CONSTR_UNKNOWN_TYPE',
								raw_expr: null
							}
						}
					]
				}
			}

			// Act
			const result = translateColumnDef(colDef)

			// Assert: column is translated but unknown constraint is ignored
			expect(result.name).toBe('status')
			expect(result.dataType).toBe('text')
			expect(result.constraints).toEqual([])
		})
	})

	describe('applyTableForeignKey — column not found (line 172: if (!col) return)', () => {
		it('does not crash when FK references a column not in columns array', () => {
			// Arrange: a CreateStmt where the table-level FK fk_attrs refers to "missing_col"
			// but no ColumnDef with that name exists
			const createStmt = {
				relation: { relname: 'orders', schemaname: null },
				tableElts: [
					{
						ColumnDef: {
							colname: 'id',
							typeName: { names: [{ String: { sval: 'int4' } }] },
							constraints: []
						}
					},
					{
						Constraint: {
							contype: 'CONSTR_FOREIGN',
							fk_attrs: [{ String: { sval: 'missing_col' } }],
							pktable: { relname: 'users', schemaname: null },
							pk_attrs: [{ String: { sval: 'id' } }]
						}
					}
				]
			}

			// Act: should not throw
			const result = translateCreateStmt(
				createStmt,
				'CREATE TABLE orders (id int, FOREIGN KEY (missing_col) REFERENCES users(id));'
			)

			// Assert: columns array is unchanged (no FK applied)
			expect(result.table[0].table).toBe('orders')
			expect(result.create_definitions).toHaveLength(1)
			expect(result.create_definitions[0].name).toBe('id')
			// No FOREIGN KEY constraint was pushed onto the id column
			expect(result.create_definitions[0].constraints).toEqual([])
		})
	})

	describe('applyTablePrimaryKey — column already has PK (line 190: false branch)', () => {
		it('does not duplicate PK constraint when column already marked as primary key', () => {
			// Column has CONSTR_PRIMARY inline AND a table-level PRIMARY KEY constraint
			// When applyTablePrimaryKey runs, col.constraints already has PRIMARY KEY
			// → if (!col.constraints.some(...)) is false → no duplicate push
			const createStmt = {
				relation: { relname: 'things', schemaname: null },
				tableElts: [
					{
						ColumnDef: {
							colname: 'id',
							typeName: { names: [{ String: { sval: 'int4' } }] },
							constraints: [{ Constraint: { contype: 'CONSTR_PRIMARY' } }]
						}
					},
					{
						Constraint: {
							contype: 'CONSTR_PRIMARY',
							keys: [{ String: { sval: 'id' } }]
						}
					}
				]
			}
			const result = translateCreateStmt(
				createStmt,
				'CREATE TABLE things (id int PRIMARY KEY, PRIMARY KEY (id));'
			)
			const idCol = result.create_definitions[0]
			const pkConstraints = idCol.constraints.filter((c) => c.type === 'PRIMARY KEY')
			// Should not have duplicate PRIMARY KEY constraints
			expect(pkConstraints.length).toBe(1)
		})
	})

	describe('applyTablePrimaryKey — column not found (lines 184-194: if (!col) continue)', () => {
		it('skips missing column in table-level PK constraint', () => {
			// Arrange: table-level PK references a column not in the definitions
			const createStmt = {
				relation: { relname: 'items', schemaname: null },
				tableElts: [
					{
						ColumnDef: {
							colname: 'name',
							typeName: { names: [{ String: { sval: 'text' } }] },
							constraints: []
						}
					},
					{
						Constraint: {
							contype: 'CONSTR_PRIMARY',
							keys: [{ String: { sval: 'ghost_col' } }]
						}
					}
				]
			}

			// Act: should not throw
			const result = translateCreateStmt(
				createStmt,
				'CREATE TABLE items (name text, PRIMARY KEY (ghost_col));'
			)

			// Assert: name column has no PK set
			expect(result.create_definitions[0].name).toBe('name')
			expect(result.create_definitions[0].nullable).toBe(true)
		})
	})

	describe('translateTableConstraint — default case', () => {
		it('returns null for unrecognised contype', () => {
			const constraint = {
				Constraint: {
					contype: 'CONSTR_EXCLUSION',
					conname: null
				}
			}
			expect(translateTableConstraint(constraint)).toBeNull()
		})
	})
})

// ─── create-trigger.js ───────────────────────────────────────────────────────

describe('create-trigger translator', () => {
	describe('timing resolution (line 10: TIMING_MAP)', () => {
		it('defaults to AFTER for unknown timing value', () => {
			// TIMING_MAP only has 2 (BEFORE) and 64 (INSTEAD OF)
			// timing=1 is not in the map, so the ?? 'AFTER' fallback fires
			const trigStmt = {
				trigname: 'trg_test',
				relation: { relname: 'orders', schemaname: null },
				timing: 1,
				events: 4, // INSERT
				funcname: [{ String: { sval: 'handle_insert' } }],
				row: true
			}
			const result = translateCreateTrigStmt(trigStmt, 'CREATE TRIGGER trg_test ...')
			expect(result.trigger.timing).toBe('AFTER')
		})

		it('returns AFTER when timing is falsy', () => {
			const trigStmt = {
				trigname: 'trg_test',
				relation: { relname: 'orders', schemaname: null },
				timing: 0,
				events: 4, // INSERT
				funcname: [{ String: { sval: 'handle_insert' } }],
				row: false
			}
			const result = translateCreateTrigStmt(trigStmt, '')
			// timing 0 is falsy — falls to 'AFTER'
			expect(result.trigger.timing).toBe('AFTER')
		})
	})
})

// ─── create-function.js ──────────────────────────────────────────────────────

describe('create-function translator', () => {
	const baseOptions = [
		{ DefElem: { defname: 'language', arg: { String: { sval: 'plpgsql' } } } },
		{
			DefElem: {
				defname: 'as',
				arg: { List: { items: [{ String: { sval: 'BEGIN RETURN; END;' } }] } }
			}
		}
	]

	it('sets isProcedure from is_procedure flag (line 64: line covered for false)', () => {
		// is_procedure = false → keyword = 'function'
		const funcStmt = {
			funcname: [{ String: { sval: 'my_func' } }],
			is_procedure: false,
			returnType: null,
			options: baseOptions,
			parameters: []
		}
		const result = translateCreateFunctionStmt(
			funcStmt,
			'CREATE FUNCTION my_func() RETURNS void ...'
		)
		expect(result.keyword).toBe('function')
	})

	it('sets returnType to null when funcStmt.returnType is absent (line 65: ternary false)', () => {
		// Line 65: funcStmt.returnType ? resolveTypeName(...) : null — null branch
		// The result has 'returns' property (not 'returnType')
		const funcStmt = {
			funcname: [{ String: { sval: 'my_proc' } }],
			is_procedure: true,
			returnType: null,
			options: baseOptions,
			parameters: []
		}
		const result = translateCreateFunctionStmt(funcStmt, 'CREATE PROCEDURE my_proc() ...')
		expect(result.returns).toBeNull()
	})

	it('sets keyword to procedure and resolves schema when name has two parts', () => {
		const funcStmt = {
			funcname: [{ String: { sval: 'app' } }, { String: { sval: 'my_procedure' } }],
			is_procedure: true,
			returnType: null,
			options: baseOptions,
			parameters: []
		}
		const result = translateCreateFunctionStmt(funcStmt, 'CREATE PROCEDURE app.my_procedure() ...')
		expect(result.keyword).toBe('procedure')
		expect(result.procedure.schema).toBe('app')
		expect(result.procedure.procedure).toBe('my_procedure')
	})

	it('buildFunctionOptions filters out non-language/non-as options (line 47: return null)', () => {
		// Line 47: return null in buildFunctionOptions for unknown defname
		const funcStmt = {
			funcname: [{ String: { sval: 'f' } }],
			is_procedure: false,
			returnType: null,
			options: [
				{ DefElem: { defname: 'language', arg: { String: { sval: 'sql' } } } },
				{ DefElem: { defname: 'security', arg: null } } // unknown → returns null → filtered out
			],
			parameters: []
		}
		const result = translateCreateFunctionStmt(funcStmt, 'CREATE FUNCTION f() ...')
		// Should only have the language option in options array
		expect(result.options).toHaveLength(1)
		expect(result.options[0].prefix).toBe('LANGUAGE')
	})

	it('resolves isOrReplace=true when originalSql contains OR REPLACE (line 71)', () => {
		// Line 71: /OR\s+REPLACE/i.test(originalSql || '')
		const funcStmt = {
			funcname: [{ String: { sval: 'f' } }],
			is_procedure: false,
			returnType: null,
			options: baseOptions,
			parameters: []
		}
		const result = translateCreateFunctionStmt(
			funcStmt,
			'CREATE OR REPLACE FUNCTION f() RETURNS void ...'
		)
		expect(result.replace).toBe(true)
		expect(result.or_replace).toBe(true)
	})

	it('resolves isOrReplace=false when originalSql is null (line 71: empty string fallback)', () => {
		const funcStmt = {
			funcname: [{ String: { sval: 'f' } }],
			is_procedure: false,
			returnType: null,
			options: baseOptions,
			parameters: []
		}
		const result = translateCreateFunctionStmt(funcStmt, null)
		expect(result.replace).toBe(false)
		expect(result.or_replace).toBe(false)
	})

	it('handles missing options property (line 67: funcStmt.options || [])', () => {
		// Line 67: const options = funcStmt.options || [] — options is undefined
		const funcStmt = {
			funcname: [{ String: { sval: 'bare_func' } }],
			is_procedure: false,
			returnType: null
			// no options property
		}
		const result = translateCreateFunctionStmt(funcStmt, 'CREATE FUNCTION bare_func() ...')
		expect(result.keyword).toBe('function')
		expect(result.options).toEqual([])
		expect(result.language).toBe('plpgsql') // default
	})
})

// ─── types.js ────────────────────────────────────────────────────────────────

describe('types translator', () => {
	describe('resolveTypeName', () => {
		it('appends type modifiers when typmods present (line 61)', () => {
			const typeName = {
				names: [{ String: { sval: 'pg_catalog' } }, { String: { sval: 'varchar' } }],
				typmods: [{ A_Const: { ival: { ival: 100 } } }]
			}
			expect(resolveTypeName(typeName)).toBe('varchar(100)')
		})

		it('uses ?? 0 fallback when A_Const.ival.ival is absent in typmods (line 60)', () => {
			// tm.A_Const?.ival?.ival is undefined → falls back to 0
			const typeName = {
				names: [{ String: { sval: 'numeric' } }],
				typmods: [{ A_Const: {} }]
			}
			expect(resolveTypeName(typeName)).toBe('numeric(0)')
		})

		it('appends [] for array types (line 64-66)', () => {
			const typeName = {
				names: [{ String: { sval: 'text' } }],
				arrayBounds: [{ ival: -1 }]
			}
			expect(resolveTypeName(typeName)).toBe('text[]')
		})
	})

	describe('resolveDefaultExpr', () => {
		it('returns fval.fval for float A_Const (line 79)', () => {
			const rawExpr = {
				A_Const: { fval: { fval: '3.14' } }
			}
			expect(resolveDefaultExpr(rawExpr)).toBe('3.14')
		})

		it('returns boolval.boolval for boolean A_Const (line 80)', () => {
			const rawExpr = {
				A_Const: { boolval: { boolval: true } }
			}
			expect(resolveDefaultExpr(rawExpr)).toBe(true)
		})

		it('returns false when boolval.boolval is undefined (nullish coalescing)', () => {
			const rawExpr = {
				A_Const: { boolval: {} }
			}
			expect(resolveDefaultExpr(rawExpr)).toBe(false)
		})

		it('falls through to FuncCall when A_Const has no recognised subtype (line 91)', () => {
			// A_Const is present but has no ival, sval, fval, or boolval →
			// resolveAConstDefault returns undefined → falls through to FuncCall
			const rawExpr = {
				A_Const: { someUnknown: 42 },
				FuncCall: {
					funcname: [{ String: { sval: 'nextval' } }]
				}
			}
			expect(resolveDefaultExpr(rawExpr)).toBe('nextval()')
		})

		it('handles TypeCast by recursing into arg (line 102-103)', () => {
			// TypeCast → recurse → A_Const.sval
			const rawExpr = {
				TypeCast: {
					arg: {
						A_Const: { sval: { sval: 'active' } }
					}
				}
			}
			expect(resolveDefaultExpr(rawExpr)).toBe('active')
		})
	})
})

// ─── where-expr.js ───────────────────────────────────────────────────────────

import { flattenJoinExpr, translateFromItem } from '../../src/parser/translators/where-expr.js'

describe('where-expr translator', () => {
	describe('translateAConst — fallback (line 35)', () => {
		it('returns { type: "expression" } when A_Const has no recognised subtype', () => {
			// Line 35: return { type: 'expression' } — no sval, ival, or boolval
			const result = translateWhereExpr({
				A_Const: { someUnknownField: 42 }
			})
			expect(result).toEqual({ type: 'expression' })
		})
	})

	describe('flattenJoinExpr — branch coverage', () => {
		it('handles missing larg (line 84: je.larg falsy)', () => {
			// je.larg is null/undefined — the if(je.larg) block is skipped
			const je = {
				larg: null,
				rarg: { RangeVar: { relname: 'orders', schemaname: null } },
				jointype: 'JOIN_LEFT',
				quals: null
			}
			const result = flattenJoinExpr(je)
			expect(result.length).toBeGreaterThanOrEqual(1)
			expect(result[0].table).toBe('orders')
		})

		it('handles larg that resolves to null (line 87: else if (left) — false)', () => {
			// translateFromItem returns null for an unknown item shape
			const je = {
				larg: { SomeUnknownNode: {} }, // translateFromItem returns null
				rarg: { RangeVar: { relname: 'products', schemaname: null } },
				jointype: 'JOIN_INNER',
				quals: null
			}
			const result = flattenJoinExpr(je)
			// left is null — not pushed; rarg still processed
			expect(result.some((r) => r.table === 'products')).toBe(true)
		})

		it('handles rarg that is an array (from nested JoinExpr) (lines 98-100)', () => {
			// rarg resolves to an array — triggers Array.isArray(right) branch
			const je = {
				larg: null,
				rarg: {
					JoinExpr: {
						larg: { RangeVar: { relname: 'a', schemaname: null } },
						rarg: { RangeVar: { relname: 'b', schemaname: null } },
						jointype: 'JOIN_LEFT',
						quals: null
					}
				},
				jointype: 'JOIN_INNER',
				quals: null
			}
			const result = flattenJoinExpr(je)
			// rarg is a JoinExpr that returns an array — covers lines 97-99
			expect(Array.isArray(result)).toBe(true)
		})

		it('handles empty rarg array (line 98: right.length === 0)', () => {
			// rarg resolves to an empty array — right[0] = {...} is skipped
			const je = {
				larg: null,
				rarg: {
					JoinExpr: {
						larg: null,
						rarg: null,
						jointype: 'JOIN_LEFT',
						quals: null
					}
				},
				jointype: 'JOIN_INNER',
				quals: null
			}
			const result = flattenJoinExpr(je)
			expect(result).toEqual([])
		})

		it('handles rarg that resolves to null (line 100: else if (right) — false branch)', () => {
			// translateFromItem returns null for unknown shapes
			// rarg is neither an array nor truthy — else if (right) false
			const je = {
				larg: null,
				rarg: { SomeUnknownNode: {} }, // translateFromItem returns null
				jointype: 'JOIN_INNER',
				quals: null
			}
			const result = flattenJoinExpr(je)
			expect(result).toEqual([])
		})
	})
})
