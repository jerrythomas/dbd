/**
 * Translator for CREATE TRIGGER statements.
 * @module translators/create-trigger
 */

const TIMING_MAP = { 2: 'BEFORE', 64: 'INSTEAD OF' }

export const translateCreateTrigStmt = (trigStmt, originalSql) => {
	const rel = trigStmt.relation
	const timing = trigStmt.timing ? (TIMING_MAP[trigStmt.timing] ?? 'AFTER') : 'AFTER'

	const events = []
	if (trigStmt.events & 4) events.push('INSERT')
	if (trigStmt.events & 8) events.push('DELETE')
	if (trigStmt.events & 16) events.push('UPDATE')
	if (trigStmt.events & 32) events.push('TRUNCATE')

	const funcName = trigStmt.funcname.map((n) => n.String?.sval).filter(Boolean)
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
