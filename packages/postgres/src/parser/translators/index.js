/**
 * Dispatcher: translates a single pgsql-parser statement into normalized AST.
 * @module translators/index
 */

import { translateCreateStmt } from './create-table.js'
import { translateViewStmt } from './create-view.js'
import { translateCreateFunctionStmt } from './create-function.js'
import { translateIndexStmt } from './create-index.js'
import { translateCreateTrigStmt } from './create-trigger.js'
import { translateVariableSetStmt } from './variable-set.js'
import { translateCommentStmt } from './comment.js'

/**
 * Translate a single pgsql-parser statement into the normalized AST shape.
 * pgsql-parser v17+ returns: { stmt: { CreateStmt: {...} }, stmt_len: N }
 */
export const translatePgStmt = (pgStmt, originalSql) => {
	const stmtWrapper = pgStmt.stmt
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
			return { type: stmtType, _raw: stmtBody, _original_sql: originalSql }
	}
}
