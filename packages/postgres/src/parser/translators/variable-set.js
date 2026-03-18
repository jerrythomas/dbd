/**
 * Translator for SET / RESET statements.
 * @module translators/variable-set
 */

export const translateVariableSetStmt = (setStmt) => ({
	type: 'set',
	variable: setStmt.name,
	value: (setStmt.args || []).map((a) => a.A_Const?.sval?.sval).filter(Boolean)
})
