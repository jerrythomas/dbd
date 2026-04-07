/**
 * Translator for CREATE VIEW statements.
 * @module translators/create-view
 */

import { translateFromItem, translateWhereExpr } from './where-expr.js'

/**
 * Recursively collect all FROM clause items from a (possibly UNION/INTERSECT/EXCEPT) SelectStmt.
 * Set-operation queries use larg/rarg instead of fromClause.
 */
const collectSetOpFromClauses = (selectStmt) => {
	if (!selectStmt) return []
	if (selectStmt.larg && selectStmt.rarg) {
		return [
			...collectSetOpFromClauses(selectStmt.larg?.SelectStmt ?? selectStmt.larg),
			...collectSetOpFromClauses(selectStmt.rarg?.SelectStmt ?? selectStmt.rarg)
		]
	}
	return selectStmt.fromClause || []
}

/**
 * Translate a ColumnRef AST node to a column reference object.
 */
const translateColumnRef = (fields) => {
	if (fields.length === 2) {
		return { type: 'column_ref', table: fields[0].String?.sval, column: fields[1].String?.sval }
	}
	if (fields[0]?.A_Star) return { type: 'star', value: '*' }
	return { type: 'column_ref', table: null, column: fields[0].String?.sval }
}

/**
 * Translate a single SELECT target expression (ColumnRef, FuncCall, or other).
 */
const translateTargetExpr = (val) => {
	if (val?.ColumnRef) return translateColumnRef(val.ColumnRef.fields)

	if (val?.FuncCall) {
		const funcName = val.FuncCall.funcname
			?.map((n) => n.String?.sval)
			.filter(Boolean)
			.join('.')
		return { type: 'function', name: { name: [{ value: funcName }] } }
	}

	if (val?.A_Expr || val?.BoolExpr || val?.TypeCast || val?.SubLink) {
		return { type: 'expression' }
	}

	return { type: 'column_ref' }
}

export const translateViewStmt = (viewStmt, originalSql) => {
	const rel = viewStmt.view
	const query = viewStmt.query?.SelectStmt

	// For set operations (UNION/INTERSECT/EXCEPT), targetList is on larg, not query directly
	const targetList = query?.targetList ?? query?.larg?.SelectStmt?.targetList ?? []
	const selectColumns = targetList
		.map((target) => {
			const rt = target.ResTarget
			return { expr: translateTargetExpr(rt.val), as: rt.name || null }
		})
		.filter(Boolean)

	// Collect FROM clauses from all branches of set operations
	const allFromItems = collectSetOpFromClauses(query)
	const fromClause = allFromItems.flatMap((item) => {
		const result = translateFromItem(item)
		return Array.isArray(result) ? result : result ? [result] : []
	})

	const where = query?.whereClause ? translateWhereExpr(query.whereClause) : null

	// Extract CTEs — pgsql-parser puts them at query.withClause.ctes (no extra wrapper key)
	const ctes = (query?.withClause?.ctes ?? []).map(({ CommonTableExpr: cte }) => ({
		name: cte.ctename,
		stmt: {
			from: (cte.ctequery?.SelectStmt?.fromClause ?? []).flatMap((item) => {
				const result = translateFromItem(item)
				return Array.isArray(result) ? result : result ? [result] : []
			})
		}
	}))

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
			where,
			...(ctes.length ? { with: ctes } : {})
		},
		_original_sql: originalSql
	}
}
