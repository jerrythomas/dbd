/**
 * SQL parsing utilities — powered by pgsql-parser (PostgreSQL C parser via WASM)
 * @module parsers/sql
 */

import { loadModule, parseSync } from 'pgsql-parser'
import errorHandler from '../utils/error-handler.js'

/** Module initialization — must be awaited before parsing */
let moduleLoaded = false
const ensureModule = async () => {
	if (!moduleLoaded) {
		await loadModule()
		moduleLoaded = true
	}
}

// Eagerly start loading the WASM module
const moduleReady = ensureModule()

/**
 * Split SQL string into individual statements.
 * Retained for backward compatibility with tests that import it directly.
 * With pgsql-parser the native parser handles multi-statement SQL,
 * but this is still useful for pre-processing and error isolation.
 * @param {string} sql - SQL string to split
 * @returns {Array<string>} Array of SQL statements
 */
export const splitStatements = (sql) => {
	const statements = []
	let current = ''
	let inString = false
	let stringChar = ''
	let inComment = false
	let commentType = ''
	let inDollarString = false
	let dollarTag = ''
	let i = 0

	while (i < sql.length) {
		const char = sql[i]
		const nextChar = sql[i + 1] || ''
		const prevChar = i > 0 ? sql[i - 1] : ''

		if (!inString && !inDollarString && !inComment && char === '-' && nextChar === '-') {
			inComment = true
			commentType = '--'
			current += char + nextChar
			i += 2
			continue
		}

		if (!inString && !inDollarString && !inComment && char === '/' && nextChar === '*') {
			inComment = true
			commentType = '/*'
			current += char + nextChar
			i += 2
			continue
		}

		if (inComment) {
			if (commentType === '--' && char === '\n') {
				inComment = false
			} else if (commentType === '/*' && char === '*' && nextChar === '/') {
				inComment = false
				current += char + nextChar
				i += 2
				continue
			}
		}

		if (!inComment && !inDollarString && (char === "'" || char === '"')) {
			if (!inString) {
				inString = true
				stringChar = char
			} else if (char === stringChar && prevChar !== '\\') {
				inString = false
			}
		}

		if (!inComment && !inString && char === '$') {
			if (!inDollarString) {
				let end = i + 1
				while (end < sql.length && sql[end] !== '$') {
					end++
				}
				if (sql[end] === '$') {
					inDollarString = true
					dollarTag = sql.substring(i, end + 1)
					current += dollarTag
					i = end + 1
					continue
				}
			} else {
				const potentialEndTag = sql.substring(i, i + dollarTag.length)
				if (potentialEndTag === dollarTag) {
					inDollarString = false
					current += dollarTag
					i += dollarTag.length
					continue
				}
			}
		}

		if (!inString && !inComment && !inDollarString && char === ';') {
			if (current.trim()) {
				statements.push(current.trim())
			}
			current = ''
			i++
			continue
		}

		current += char
		i++
	}

	if (current.trim()) {
		statements.push(current.trim())
	}

	return statements
}

// ─── pgsql-parser AST → normalized AST translation ─────────────────────────

/**
 * Map a pgsql-parser type name to a user-friendly string.
 * pgsql-parser represents types as arrays of String nodes.
 * e.g. [{String:{sval:"pg_catalog"}},{String:{sval:"int4"}}]
 * We want "int" not "pg_catalog.int4"
 */
const PG_TYPE_MAP = {
	int2: 'smallint',
	int4: 'int',
	int8: 'bigint',
	float4: 'real',
	float8: 'double precision',
	bool: 'boolean',
	varchar: 'varchar',
	bpchar: 'char',
	numeric: 'numeric',
	text: 'text',
	uuid: 'uuid',
	jsonb: 'jsonb',
	json: 'json',
	timestamp: 'timestamp',
	timestamptz: 'timestamptz',
	date: 'date',
	time: 'time',
	timetz: 'timetz',
	interval: 'interval',
	bytea: 'bytea',
	serial: 'serial',
	serial4: 'serial',
	serial8: 'bigserial',
	bigserial: 'bigserial',
	oid: 'oid',
	inet: 'inet',
	cidr: 'cidr',
	macaddr: 'macaddr',
	xml: 'xml',
	money: 'money',
	bit: 'bit',
	varbit: 'varbit',
	point: 'point',
	line: 'line',
	lseg: 'lseg',
	box: 'box',
	path: 'path',
	polygon: 'polygon',
	circle: 'circle',
	tsvector: 'tsvector',
	tsquery: 'tsquery'
}

/**
 * Convert a pgsql-parser typeName node to a human-readable type string
 */
const resolveTypeName = (typeName) => {
	if (!typeName || !typeName.names) return null

	const names = typeName.names.map((n) => n.String?.sval).filter(Boolean)

	// Skip pg_catalog prefix
	const baseName = names.length > 1 && names[0] === 'pg_catalog' ? names[1] : names.join('.')

	let resolved = PG_TYPE_MAP[baseName] || baseName

	// Handle typmods (length/precision)
	// pgsql-parser v17 shape: typmods: [{ A_Const: { ival: { ival: 100 }, location: N } }]
	if (typeName.typmods && typeName.typmods.length > 0) {
		const mods = typeName.typmods
			.map((tm) => {
				// { A_Const: { ival: { ival: N } } }
				if (tm.A_Const?.ival?.ival !== undefined) return tm.A_Const.ival.ival
				// { A_Const: { fval: { fval: "N.N" } } }
				if (tm.A_Const?.fval?.fval !== undefined) return tm.A_Const.fval.fval
				// Direct Integer (older format)
				if (tm.Integer?.ival !== undefined) return tm.Integer.ival
				return undefined
			})
			.filter((v) => v !== undefined)

		if (mods.length > 0) {
			resolved += `(${mods.join(',')})`
		}
	}

	// Handle array types
	if (typeName.arrayBounds && typeName.arrayBounds.length > 0) {
		resolved += '[]'
	}

	return resolved
}

/**
 * Extract a default value expression from a Constraint node's raw_expr.
 * pgsql-parser v17 uses double-nested wrappers:
 *   { A_Const: { ival: { ival: 42 }, location: N } }
 *   { A_Const: { sval: { sval: "hello" }, location: N } }
 *   { A_Const: { boolval: { boolval: true }, location: N } }
 */
const resolveDefaultExpr = (rawExpr) => {
	if (!rawExpr) return null

	// A_Const wrapper (pgsql-parser v17 shape)
	if (rawExpr.A_Const) {
		const ac = rawExpr.A_Const
		if (ac.ival?.ival !== undefined) return ac.ival.ival
		if (ac.sval?.sval !== undefined) return ac.sval.sval
		if (ac.fval?.fval !== undefined) return ac.fval.fval
		if (ac.boolval?.boolval !== undefined) return ac.boolval.boolval
		// Fallback for simpler shapes
		if (typeof ac.ival === 'number') return ac.ival
		if (typeof ac.sval === 'string') return ac.sval
		if (typeof ac.boolval === 'boolean') return ac.boolval
	}

	// Simple constants (older format)
	if (rawExpr.Integer !== undefined) return rawExpr.Integer.ival
	if (rawExpr.String !== undefined) return rawExpr.String.sval
	if (rawExpr.Float !== undefined) return rawExpr.Float.fval

	// Function call — e.g. uuid_generate_v4(), now()
	if (rawExpr.FuncCall) {
		const funcName = rawExpr.FuncCall.funcname
			?.map((n) => n.String?.sval)
			.filter(Boolean)
			.join('.')
		return `${funcName}()`
	}

	// TypeCast — e.g. 'true'::boolean
	if (rawExpr.TypeCast) {
		const inner = resolveDefaultExpr(rawExpr.TypeCast.arg)
		return inner
	}

	return '[EXPRESSION]'
}

/**
 * Translate a pgsql-parser ColumnDef into the normalized column shape
 * expected by the extractors.
 */
const translateColumnDef = (colDef) => {
	const cd = colDef.ColumnDef
	if (!cd) return null

	const dataType = resolveTypeName(cd.typeName)
	let nullable = true
	let defaultValue = null
	const constraints = []
	let isPrimaryKey = false

	if (cd.constraints) {
		for (const c of cd.constraints) {
			const con = c.Constraint
			if (!con) continue

			switch (con.contype) {
				case 'CONSTR_NOTNULL':
					nullable = false
					break
				case 'CONSTR_DEFAULT':
					defaultValue = resolveDefaultExpr(con.raw_expr)
					break
				case 'CONSTR_PRIMARY':
					isPrimaryKey = true
					nullable = false
					constraints.push({ type: 'PRIMARY KEY' })
					break
				case 'CONSTR_UNIQUE':
					constraints.push({ type: 'UNIQUE' })
					break
				case 'CONSTR_FOREIGN':
					constraints.push({
						type: 'FOREIGN KEY',
						table: con.pktable?.relname || null,
						schema: con.pktable?.schemaname || null,
						column: con.pk_attrs?.[0]?.String?.sval || 'id'
					})
					break
				case 'CONSTR_CHECK':
					constraints.push({ type: 'CHECK' })
					break
			}
		}
	}

	return {
		name: cd.colname,
		dataType,
		nullable,
		defaultValue,
		constraints,
		// Compat shape expected by extractors:
		column: {
			column: {
				expr: { type: 'default', value: cd.colname }
			}
		},
		definition: { dataType: dataType?.toUpperCase() || null },
		...(isPrimaryKey ? { primary_key: 'primary key' } : {}),
		...(nullable
			? {}
			: {
					nullable: { type: 'not null', value: 'not null' }
				}),
		...(defaultValue !== null
			? {
					default_val: {
						type: 'default',
						value:
							typeof defaultValue === 'string' && defaultValue.includes('(')
								? {
										type: 'function',
										name: {
											name: [{ value: defaultValue.replace(/\(\)$/, '') }]
										},
										args: { type: 'expr_list', value: [] }
									}
								: defaultValue
					}
				}
			: {}),
		// FK compat shape
		...(constraints.some((c) => c.type === 'FOREIGN KEY')
			? {
					reference_definition: (() => {
						const fk = constraints.find((c) => c.type === 'FOREIGN KEY')
						return {
							table: [{ table: fk.table, schema: fk.schema }],
							definition: [{ column: { expr: { value: fk.column } } }]
						}
					})()
				}
			: {})
	}
}

/**
 * Translate a table-level Constraint (from tableElts) into normalized shape
 */
const translateTableConstraint = (constraint) => {
	const con = constraint.Constraint
	if (!con) return null

	const base = { resource: 'constraint' }

	switch (con.contype) {
		case 'CONSTR_PRIMARY':
			return {
				...base,
				type: 'primary_key',
				constraint: 'PRIMARY KEY',
				conname: con.conname,
				keys: (con.keys || []).map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_UNIQUE':
			return {
				...base,
				type: 'unique',
				constraint: 'UNIQUE',
				conname: con.conname,
				keys: (con.keys || []).map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_FOREIGN':
			return {
				...base,
				type: 'foreign_key',
				constraint: 'FOREIGN KEY',
				conname: con.conname,
				fk_attrs: (con.fk_attrs || []).map((k) => k.String?.sval).filter(Boolean),
				pktable: {
					relname: con.pktable?.relname,
					schemaname: con.pktable?.schemaname
				},
				pk_attrs: (con.pk_attrs || []).map((k) => k.String?.sval).filter(Boolean)
			}
		case 'CONSTR_CHECK':
			return {
				...base,
				type: 'check',
				constraint: 'CHECK',
				conname: con.conname
			}
		default:
			return null
	}
}

/**
 * Translate a pgsql-parser CreateStmt into the normalized shape.
 */
const translateCreateStmt = (createStmt, originalSql) => {
	const rel = createStmt.relation || {}
	const tableElts = createStmt.tableElts || []

	// Separate columns from table-level constraints
	const columnDefs = tableElts.filter((e) => e.ColumnDef)
	const tableConstraints = tableElts.filter((e) => e.Constraint)

	// Translate columns
	const columns = columnDefs.map(translateColumnDef).filter(Boolean)

	// Apply table-level FK constraints to columns
	for (const tc of tableConstraints) {
		const con = tc.Constraint
		if (con?.contype === 'CONSTR_FOREIGN' && con.fk_attrs?.length) {
			const fkColName = con.fk_attrs[0].String?.sval
			const col = columns.find((c) => c.name === fkColName)
			if (col) {
				const fk = {
					type: 'FOREIGN KEY',
					table: con.pktable?.relname || null,
					schema: con.pktable?.schemaname || null,
					column: con.pk_attrs?.[0]?.String?.sval || 'id'
				}
				col.constraints.push(fk)
				// Add compat shape
				col.reference_definition = {
					table: [{ table: fk.table, schema: fk.schema }],
					definition: [{ column: { expr: { value: fk.column } } }]
				}
			}
		}
		// Table-level PRIMARY KEY
		if (con?.contype === 'CONSTR_PRIMARY' && con.keys?.length) {
			for (const key of con.keys) {
				const colName = key.String?.sval
				const col = columns.find((c) => c.name === colName)
				if (col) {
					col.nullable = false
					if (!col.constraints.some((c) => c.type === 'PRIMARY KEY')) {
						col.constraints.push({ type: 'PRIMARY KEY' })
					}
					col.primary_key = 'primary key'
				}
			}
		}
	}

	return {
		type: 'create',
		keyword: 'table',
		table: [
			{
				db: rel.schemaname || null,
				schema: rel.schemaname || null,
				table: rel.relname,
				as: null
			}
		],
		if_not_exists: createStmt.if_not_exists || false,
		create_definitions: columns,
		_table_constraints: tableConstraints.map(translateTableConstraint).filter(Boolean),
		_original_sql: originalSql
	}
}

/**
 * Translate a pgsql-parser ViewStmt into the normalized shape.
 */
const translateViewStmt = (viewStmt, originalSql) => {
	const rel = viewStmt.view || {}
	const query = viewStmt.query?.SelectStmt

	// Translate SELECT columns
	const selectColumns = (query?.targetList || [])
		.map((target) => {
			const rt = target.ResTarget
			if (!rt) return null

			const val = rt.val
			let expr = { type: 'column_ref' }

			if (val?.ColumnRef) {
				const fields = val.ColumnRef.fields || []
				if (fields.length === 2) {
					expr = {
						type: 'column_ref',
						table: fields[0].String?.sval,
						column: fields[1].String?.sval
					}
				} else if (fields.length === 1) {
					if (fields[0].A_Star) {
						expr = { type: 'star', value: '*' }
					} else {
						expr = {
							type: 'column_ref',
							table: null,
							column: fields[0].String?.sval
						}
					}
				}
			} else if (val?.FuncCall) {
				const funcName = val.FuncCall.funcname
					?.map((n) => n.String?.sval)
					.filter(Boolean)
					.join('.')
				expr = {
					type: 'function',
					name: { name: [{ value: funcName }] }
				}
			} else if (val?.A_Star) {
				expr = { type: 'star', value: '*' }
			} else if (val?.A_Expr || val?.BoolExpr || val?.TypeCast || val?.SubLink) {
				expr = { type: 'expression' }
			}

			return {
				expr,
				as: rt.name || null
			}
		})
		.filter(Boolean)

	// Translate FROM clause — flatMap handles JoinExpr returning arrays
	const fromClause = (query?.fromClause || []).flatMap((item) => {
		const result = translateFromItem(item)
		return Array.isArray(result) ? result : result ? [result] : []
	})

	// Translate WHERE clause
	const where = query?.whereClause ? translateWhereExpr(query.whereClause) : null

	return {
		type: 'create',
		keyword: 'view',
		view: {
			view: rel.relname,
			db: rel.schemaname || null,
			schema: rel.schemaname || null
		},
		replace: viewStmt.replace || false,
		or_replace: viewStmt.replace || false,
		select: {
			type: 'select',
			columns: selectColumns,
			from: fromClause,
			where
		},
		_original_sql: originalSql
	}
}

/**
 * Flatten a JoinExpr into an array of table references.
 * Recursively handles nested joins (A JOIN B JOIN C).
 */
const flattenJoinExpr = (je) => {
	const joinTypeMap = {
		0: 'INNER JOIN',
		1: 'LEFT JOIN',
		2: 'FULL JOIN',
		3: 'RIGHT JOIN',
		4: 'CROSS JOIN',
		JOIN_INNER: 'INNER JOIN',
		JOIN_LEFT: 'LEFT JOIN',
		JOIN_FULL: 'FULL JOIN',
		JOIN_RIGHT: 'RIGHT JOIN',
		JOIN_CROSS: 'CROSS JOIN'
	}

	const items = []

	// Collect left side (may be a table or another join)
	if (je.larg) {
		const left = translateFromItem(je.larg)
		if (Array.isArray(left)) {
			items.push(...left)
		} else if (left) {
			items.push(left)
		}
	}

	// Collect right side with join metadata
	if (je.rarg) {
		const right = translateFromItem(je.rarg)
		const joinInfo = {
			type: joinTypeMap[je.jointype] || 'JOIN',
			on: je.quals ? translateWhereExpr(je.quals) : null
		}

		if (Array.isArray(right)) {
			// Nested join on right — add join info to first item
			if (right.length > 0) {
				right[0] = { ...right[0], ...joinInfo }
			}
			items.push(...right)
		} else if (right) {
			items.push({ ...right, ...joinInfo })
		}
	}

	return items
}

/**
 * Translate a FROM clause item (RangeVar, JoinExpr, etc.)
 */
const translateFromItem = (item) => {
	// Simple table reference
	if (item.RangeVar) {
		const rv = item.RangeVar
		return {
			db: rv.schemaname || null,
			schema: rv.schemaname || null,
			table: rv.relname,
			name: rv.relname,
			as: rv.alias?.aliasname || null
		}
	}

	// JOIN expression — flatten into array for easy processing by extractors
	if (item.JoinExpr) {
		return flattenJoinExpr(item.JoinExpr)
	}

	// Subquery
	if (item.RangeSubselect) {
		return { expr: { type: 'subquery' } }
	}

	return null
}

/**
 * Translate a WHERE clause expression to a simplified normalized shape
 */
const translateWhereExpr = (expr) => {
	if (!expr) return null

	if (expr.BoolExpr) {
		const boolOp = {
			0: 'AND',
			1: 'OR',
			2: 'NOT',
			AND_EXPR: 'AND',
			OR_EXPR: 'OR',
			NOT_EXPR: 'NOT'
		}
		return {
			type: 'binary_expr',
			operator: boolOp[expr.BoolExpr.boolop] || expr.BoolExpr.boolop,
			args: (expr.BoolExpr.args || []).map(translateWhereExpr)
		}
	}

	if (expr.A_Expr) {
		return {
			type: 'binary_expr',
			operator: expr.A_Expr.name?.[0]?.String?.sval || '=',
			left: translateWhereExpr(expr.A_Expr.lexpr),
			right: translateWhereExpr(expr.A_Expr.rexpr)
		}
	}

	if (expr.ColumnRef) {
		const fields = expr.ColumnRef.fields || []
		return {
			type: 'column_ref',
			table: fields.length > 1 ? fields[0].String?.sval : null,
			column: fields[fields.length - 1]?.String?.sval
		}
	}

	if (expr.A_Const) {
		if (expr.A_Const.sval) return { type: 'string', value: expr.A_Const.sval.sval }
		if (expr.A_Const.ival !== undefined) return { type: 'number', value: expr.A_Const.ival }
		if (expr.A_Const.boolval !== undefined) return { type: 'bool', value: expr.A_Const.boolval }
	}

	if (expr.TypeCast) {
		return translateWhereExpr(expr.TypeCast.arg)
	}

	return { type: 'expression' }
}

/**
 * Translate a pgsql-parser CreateFunctionStmt into the normalized shape.
 * Used for both CREATE FUNCTION and CREATE PROCEDURE.
 */
const translateCreateFunctionStmt = (funcStmt, originalSql) => {
	const funcnames = funcStmt.funcname || []
	const nameStr = funcnames.map((n) => n.String?.sval).filter(Boolean)

	const schema = nameStr.length > 1 ? nameStr[0] : null
	const name = nameStr.length > 1 ? nameStr[1] : nameStr[0] || ''

	// Determine if this is a procedure (RETURNS void with no RETURNS) vs function
	// In PostgreSQL, CREATE PROCEDURE has is_procedure = true
	const isProcedure = funcStmt.is_procedure || false

	// Extract return type
	const returnType = funcStmt.returnType ? resolveTypeName(funcStmt.returnType) : null

	// Extract language and body from options
	let language = 'plpgsql'
	let body = ''
	if (funcStmt.options) {
		for (const opt of funcStmt.options) {
			const de = opt.DefElem
			if (!de) continue
			if (de.defname === 'language') {
				language = de.arg?.String?.sval || 'plpgsql'
			}
			if (de.defname === 'as') {
				// Body is in arg — can be List (v17+), Array, or direct String
				if (de.arg?.List?.items) {
					body = de.arg.List.items
						.map((a) => a.String?.sval)
						.filter(Boolean)
						.join('')
				} else if (Array.isArray(de.arg)) {
					body = de.arg
						.map((a) => a.String?.sval)
						.filter(Boolean)
						.join('')
				} else if (de.arg?.String?.sval) {
					body = de.arg.String.sval
				}
			}
		}
	}

	// Extract parameters
	const parameters = (funcStmt.parameters || [])
		.map((param) => {
			const fp = param.FunctionParameter
			if (!fp) return null

			const modeMap = {
				105: 'in', // FUNC_PARAM_IN (ASCII 'i')
				111: 'out', // FUNC_PARAM_OUT (ASCII 'o')
				98: 'inout' // FUNC_PARAM_INOUT (ASCII 'b')
			}

			return {
				name: fp.name || '',
				dataType: fp.argType ? resolveTypeName(fp.argType) : 'unknown',
				mode: modeMap[fp.mode] || 'in'
			}
		})
		.filter(Boolean)

	const keyword = isProcedure ? 'procedure' : 'function'

	return {
		type: 'create',
		keyword,
		[keyword]: {
			[keyword]: name,
			name,
			schema
		},
		// Function AST compat
		name: {
			name: [{ value: name }],
			schema
		},
		replace: originalSql?.match(/OR\s+REPLACE/i) ? true : false,
		or_replace: originalSql?.match(/OR\s+REPLACE/i) ? true : false,
		language,
		parameters,
		args: parameters,
		returns: returnType,
		as: body,
		body,
		options: funcStmt.options
			? funcStmt.options
					.map((o) => {
						const de = o.DefElem
						if (!de) return null
						if (de.defname === 'language') return { prefix: 'LANGUAGE', value: language }
						if (de.defname === 'as') return { type: 'as', expr: body }
						return null
					})
					.filter(Boolean)
			: [],
		_original_sql: originalSql
	}
}

/**
 * Translate a pgsql-parser IndexStmt into the normalized shape.
 */
const translateIndexStmt = (indexStmt, originalSql) => {
	const rel = indexStmt.relation || {}

	const columns = (indexStmt.indexParams || [])
		.map((param) => {
			const ie = param.IndexElem
			if (!ie) return null

			let order = 'ASC'
			if (ie.ordering === 'SORTBY_DESC') order = 'DESC'

			return {
				name: ie.name,
				order,
				// Compat shape
				column: { column: { expr: { value: ie.name } } }
			}
		})
		.filter(Boolean)

	return {
		type: 'create',
		keyword: 'index',
		index: {
			name: indexStmt.idxname,
			schema: null
		},
		indexname: indexStmt.idxname,
		table: {
			table: rel.relname,
			schema: rel.schemaname || null
		},
		table_name: [{ table: rel.relname, schema: rel.schemaname || null }],
		unique: indexStmt.unique || false,
		if_not_exists: indexStmt.if_not_exists || false,
		accessMethod: indexStmt.accessMethod,
		columns,
		_original_sql: originalSql
	}
}

/**
 * Translate a pgsql-parser CreateTrigStmt into the normalized shape.
 */
const translateCreateTrigStmt = (trigStmt, originalSql) => {
	const rel = trigStmt.relation || {}

	// Timing: 2 = BEFORE, 4 = AFTER, 64 = INSTEAD OF
	const timingMap = { 2: 'BEFORE', 4: 'AFTER', 64: 'INSTEAD OF' }
	const timing = timingMap[trigStmt.timing] || 'BEFORE'

	// Events are bitmask: 4 = INSERT, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE
	const events = []
	if (trigStmt.events & 4) events.push('INSERT')
	if (trigStmt.events & 8) events.push('DELETE')
	if (trigStmt.events & 16) events.push('UPDATE')
	if (trigStmt.events & 32) events.push('TRUNCATE')

	const funcName = (trigStmt.funcname || []).map((n) => n.String?.sval).filter(Boolean)

	const funcSchema = funcName.length > 1 ? funcName[0] : null
	const funcBaseName = funcName.length > 1 ? funcName[1] : funcName[0]

	return {
		type: 'create',
		keyword: 'trigger',
		trigger: {
			name: trigStmt.trigname,
			table: rel.relname,
			tableSchema: rel.schemaname || null,
			timing,
			events,
			executeFunction: funcSchema ? `${funcSchema}.${funcBaseName}` : funcBaseName,
			row: trigStmt.row || false
		},
		_original_sql: originalSql
	}
}

/**
 * Translate a pgsql-parser VariableSetStmt into the normalized shape.
 */
const translateVariableSetStmt = (setStmt) => {
	if (setStmt.name !== 'search_path') {
		return {
			type: 'set',
			variable: setStmt.name,
			value: (setStmt.args || []).map((a) => a.A_Const?.sval?.sval).filter(Boolean)
		}
	}

	return {
		type: 'set',
		variable: 'search_path',
		value: (setStmt.args || []).map((a) => a.A_Const?.sval?.sval).filter(Boolean)
	}
}

/**
 * Translate a pgsql-parser CommentStmt into the normalized shape.
 */
const translateCommentStmt = (commentStmt) => {
	const items = commentStmt.object?.List?.items || []
	const names = items.map((i) => i.String?.sval).filter(Boolean)

	if (commentStmt.objtype === 'OBJECT_TABLE') {
		// names = [schema, table] or [table]
		const tableName = names.length > 1 ? names[1] : names[0]
		const schemaName = names.length > 1 ? names[0] : null

		return {
			type: 'comment',
			keyword: 'on',
			target: {
				type: 'table',
				name: schemaName
					? { table: tableName, schema: schemaName, db: schemaName }
					: { table: tableName }
			},
			expr: {
				expr: { value: commentStmt.comment }
			}
		}
	}

	if (commentStmt.objtype === 'OBJECT_COLUMN') {
		// names = [schema, table, column] or [table, column]
		let schemaName, tableName, columnName
		if (names.length === 3) {
			schemaName = names[0]
			tableName = names[1]
			columnName = names[2]
		} else if (names.length === 2) {
			tableName = names[0]
			columnName = names[1]
		} else {
			columnName = names[0]
		}

		return {
			type: 'comment',
			keyword: 'on',
			target: {
				type: 'column',
				name: {
					table: tableName,
					schema: schemaName,
					db: schemaName,
					column: { expr: { value: columnName } }
				}
			},
			expr: {
				expr: { value: commentStmt.comment }
			}
		}
	}

	// Other object types (OBJECT_INDEX, etc.)
	return {
		type: 'comment',
		keyword: 'on',
		target: { type: commentStmt.objtype },
		expr: { expr: { value: commentStmt.comment } }
	}
}

/**
 * Translate a single pgsql-parser statement into the normalized AST shape
 * that the extractors expect.
 *
 * pgsql-parser v17+ returns: { stmt: { CreateStmt: {...} }, stmt_len: N }
 */
const translatePgStmt = (pgStmt, originalSql) => {
	const stmtWrapper = pgStmt.stmt
	if (!stmtWrapper) return null

	const stmtType = Object.keys(stmtWrapper)[0]
	const stmtBody = stmtWrapper[stmtType]

	switch (stmtType) {
		case 'CreateStmt':
			return translateCreateStmt(stmtBody, originalSql)
		case 'ViewStmt':
			return translateViewStmt(stmtBody, originalSql)
		case 'CreateFunctionStmt':
			return translateCreateFunctionStmt(stmtBody, originalSql)
		case 'IndexStmt':
			return translateIndexStmt(stmtBody, originalSql)
		case 'CreateTrigStmt':
			return translateCreateTrigStmt(stmtBody, originalSql)
		case 'VariableSetStmt':
			return translateVariableSetStmt(stmtBody)
		case 'CommentStmt':
			return translateCommentStmt(stmtBody)
		default:
			// Pass through unsupported statements with type info
			return {
				type: stmtType,
				_raw: stmtBody,
				_original_sql: originalSql
			}
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse SQL string into normalized AST.
 * Uses pgsql-parser (PostgreSQL C parser) for accurate parsing,
 * then translates the AST into the shape expected by extractors.
 *
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options (kept for API compat)
 * @returns {Array} Normalized AST representation of the SQL
 */
export const parse = (sql, options = {}) => {
	if (!sql || typeof sql !== 'string' || !sql.trim()) {
		const result = []
		result._original_sql = sql
		return result
	}

	// Try parsing the full SQL first (fastest path)
	try {
		const parsed = parseSync(sql)
		const stmts = parsed.stmts || []
		const result = stmts.map((pgStmt) => translatePgStmt(pgStmt, sql)).filter(Boolean)

		result._original_sql = sql
		return result
	} catch {
		// Full parse failed — fall back to statement-by-statement parsing
		// This handles cases where one invalid statement shouldn't block the rest
	}

	// Statement-level error isolation
	const statements = splitStatements(sql)
	const result = []

	for (const stmt of statements) {
		try {
			const parsed = parseSync(stmt)
			const stmts = parsed.stmts || []
			for (const pgStmt of stmts) {
				const translated = translatePgStmt(pgStmt, sql)
				if (translated) result.push(translated)
			}
		} catch (err) {
			errorHandler.handleParsingError(err, stmt, 'statement parsing')
		}
	}

	result._original_sql = sql
	return result
}

/**
 * Parse SET search_path statement (kept for backward compatibility)
 * @param {string} stmt - SET search_path statement
 * @returns {Array} Parsed statement
 */
export const parseSearchPath = (stmt) => {
	const regex = /SET\s+search_path\s+(?:TO\s+)?(.+?)(;|\s*$)/i
	const match = regex.exec(stmt)

	if (!match) return []

	const value = match[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	return [
		{
			type: 'set',
			variable: 'search_path',
			value
		}
	]
}

/**
 * Validate SQL without throwing errors
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Parser options
 * @returns {Object} Validation result
 */
export const validateSQL = (sql, options = {}) => {
	return errorHandler.withConfig(
		() => {
			try {
				const parsedStatements = parse(sql, options)
				const valid = Array.isArray(parsedStatements) && parsedStatements.length > 0
				const errors = errorHandler.getErrors()

				return {
					valid,
					message: valid ? 'Valid SQL' : 'Error: Invalid or unsupported SQL',
					errors
				}
			} catch (err) {
				errorHandler.handleParsingError(err, sql, 'validation')
				return {
					valid: false,
					message: `Error: ${err.message}`,
					errors: errorHandler.getErrors()
				}
			}
		},
		{ logToConsole: false, collectErrors: true }
	)
}

/**
 * Initialize the pgsql-parser WASM module.
 * Call this at application startup. Parsing will work without calling this,
 * but the first parse will be slightly slower due to lazy initialization.
 */
export const initParser = () => moduleReady
