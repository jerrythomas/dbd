/**
 * Translator for CREATE VIEW statements.
 * @module translators/create-view
 */

import { translateFromItem, translateWhereExpr } from './where-expr.js'

/**
 * Translate a single SELECT target expression (ColumnRef, FuncCall, or other).
 */
const translateTargetExpr = (val) => {
	if (val?.ColumnRef) {
		const fields = val.ColumnRef.fields
		if (fields.length === 2) {
			return {
				type: 'column_ref',
				table: fields[0].String?.sval,
				column: fields[1].String?.sval
			}
		}
		if (fields[0]?.A_Star) return { type: 'star', value: '*' }
		return { type: 'column_ref', table: null, column: fields[0].String?.sval }
	}

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

	const selectColumns = query.targetList
		.map((target) => {
			const rt = target.ResTarget
			return { expr: translateTargetExpr(rt.val), as: rt.name || null }
		})
		.filter(Boolean)

	const fromClause = (query?.fromClause || []).flatMap((item) => {
		const result = translateFromItem(item)
		return Array.isArray(result) ? result : result ? [result] : []
	})

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
		select: { type: 'select', columns: selectColumns, from: fromClause, where },
		_original_sql: originalSql
	}
}
