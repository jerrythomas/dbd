/**
 * Translator for CREATE INDEX statements.
 * @module translators/create-index
 */

export const translateIndexStmt = (indexStmt, originalSql) => {
	const rel = indexStmt.relation

	const columns = indexStmt.indexParams.map((param) => {
		const ie = param.IndexElem
		const order = ie.ordering === 'SORTBY_DESC' ? 'DESC' : 'ASC'
		return {
			name: ie.name,
			order,
			column: { column: { expr: { value: ie.name } } }
		}
	})

	return {
		type: 'create',
		keyword: 'index',
		index: { name: indexStmt.idxname, schema: null },
		indexname: indexStmt.idxname,
		table: { table: rel.relname, schema: rel.schemaname || null },
		table_name: [{ table: rel.relname, schema: rel.schemaname || null }],
		unique: indexStmt.unique || false,
		if_not_exists: indexStmt.if_not_exists || false,
		accessMethod: indexStmt.accessMethod,
		columns,
		_original_sql: originalSql
	}
}
