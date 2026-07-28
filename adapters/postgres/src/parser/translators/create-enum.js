/**
 * Translator for CREATE TYPE ... AS ENUM statements.
 * @module translators/create-enum
 */

export const translateCreateEnumStmt = (enumStmt, originalSql) => {
	const names = enumStmt.typeName.map((n) => n.String?.sval).filter(Boolean)
	const schema = names.length > 1 ? names[0] : null
	const name = names[names.length - 1]
	const values = (enumStmt.vals || []).map((v) => v.String?.sval).filter(Boolean)

	return {
		type: 'create',
		keyword: 'enum',
		name: { name, schema },
		values,
		_original_sql: originalSql
	}
}
