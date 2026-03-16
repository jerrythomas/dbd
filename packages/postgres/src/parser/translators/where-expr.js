/**
 * Translators for WHERE expressions and FROM clause items.
 * @module translators/where-expr
 */

const BOOL_OP_MAP = {
	0: 'AND',
	1: 'OR',
	2: 'NOT',
	AND_EXPR: 'AND',
	OR_EXPR: 'OR',
	NOT_EXPR: 'NOT'
}

const JOIN_TYPE_MAP = {
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

/**
 * Translate an A_Const AST node to a normalized constant value.
 */
const translateAConst = (ac) => {
	if (ac.sval) return { type: 'string', value: ac.sval.sval }
	if (ac.ival !== undefined) return { type: 'number', value: ac.ival.ival ?? 0 }
	if (ac.boolval !== undefined) return { type: 'bool', value: ac.boolval.boolval ?? false }
	return { type: 'expression' }
}

/**
 * Translate a WHERE clause expression to a simplified normalized shape.
 */
export const translateWhereExpr = (expr) => {
	if (expr.BoolExpr) {
		return {
			type: 'binary_expr',
			operator: BOOL_OP_MAP[expr.BoolExpr.boolop],
			args: expr.BoolExpr.args.map(translateWhereExpr)
		}
	}

	if (expr.A_Expr) {
		return {
			type: 'binary_expr',
			operator: expr.A_Expr.name[0].String.sval,
			left: translateWhereExpr(expr.A_Expr.lexpr),
			right: translateWhereExpr(expr.A_Expr.rexpr)
		}
	}

	if (expr.ColumnRef) {
		const fields = expr.ColumnRef.fields
		return {
			type: 'column_ref',
			table: fields.length > 1 ? fields[0].String?.sval : null,
			column: fields[fields.length - 1]?.String?.sval
		}
	}

	if (expr.A_Const) return translateAConst(expr.A_Const)

	if (expr.TypeCast) {
		return translateWhereExpr(expr.TypeCast.arg)
	}

	return { type: 'expression' }
}

/**
 * Flatten a JoinExpr into an array of table references.
 * Recursively handles nested joins (A JOIN B JOIN C).
 */
export const flattenJoinExpr = (je) => {
	const items = []

	if (je.larg) {
		const left = translateFromItem(je.larg)
		if (Array.isArray(left)) items.push(...left)
		else if (left) items.push(left)
	}

	if (je.rarg) {
		const right = translateFromItem(je.rarg)
		const joinInfo = {
			type: JOIN_TYPE_MAP[je.jointype],
			on: je.quals ? translateWhereExpr(je.quals) : null
		}

		if (Array.isArray(right)) {
			if (right.length > 0) right[0] = { ...right[0], ...joinInfo }
			items.push(...right)
		} else if (right) {
			items.push({ ...right, ...joinInfo })
		}
	}

	return items
}

/**
 * Translate a FROM clause item (RangeVar, JoinExpr, RangeSubselect).
 */
export const translateFromItem = (item) => {
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

	if (item.JoinExpr) return flattenJoinExpr(item.JoinExpr)
	if (item.RangeSubselect) return { expr: { type: 'subquery' } }

	return null
}
