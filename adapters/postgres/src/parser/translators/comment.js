/**
 * Translator for COMMENT ON statements.
 * @module translators/comment
 */

const resolveCommentNames = (object) => {
	const items = object?.List?.items || []
	return items.map((i) => i.String?.sval).filter(Boolean)
}

const translateTableComment = (names, comment) => {
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
		expr: { expr: { value: comment } }
	}
}

const translateColumnComment = (names, comment) => {
	let schemaName, tableName, columnName
	if (names.length === 3) {
		;[schemaName, tableName, columnName] = names
	} else {
		;[tableName, columnName] = names
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
		expr: { expr: { value: comment } }
	}
}

export const translateCommentStmt = (commentStmt) => {
	const names = resolveCommentNames(commentStmt.object)

	if (commentStmt.objtype === 'OBJECT_TABLE') {
		return translateTableComment(names, commentStmt.comment)
	}

	if (commentStmt.objtype === 'OBJECT_COLUMN') {
		return translateColumnComment(names, commentStmt.comment)
	}

	return {
		type: 'comment',
		keyword: 'on',
		target: { type: commentStmt.objtype },
		expr: { expr: { value: commentStmt.comment } }
	}
}
