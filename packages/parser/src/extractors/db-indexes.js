/**
 * Database indexes extractor module
 * @module extractors/db-indexes
 */

import { pipe, filter, map, curry, prop, propEq, find, assoc } from 'ramda'
import { extractSearchPath } from './tables.js'

/**
 * Extract all index definitions from an AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Array} Extracted index definitions
 */
export const extractIndexes = (ast) => {
	if (!ast || !Array.isArray(ast)) return []

	// Find search_path if it exists
	const searchPath = extractSearchPath(ast)

	// Extract indexes
	// Add original statements for reference
	let indexes = pipe(
		filter((stmt) => stmt.type === 'create' && stmt.keyword === 'index'),
		map(indexDefFromStatement(searchPath))
	)(ast)

	// Extract indexes from SQL text if AST parsing failed or no indexes found
	if (ast._original_sql) {
		const sqlIndexes = extractIndexesFromSql(ast._original_sql, searchPath)
		if (sqlIndexes.length > 0) {
			// Prefer SQL indexes as they contain more complete information
			indexes = sqlIndexes
		}
	}

	// Additional check - if we have indexes but the unique property isn't correctly set
	if (indexes.length > 0 && ast._original_sql) {
		const originalSQL = ast._original_sql.toUpperCase()
		indexes = indexes.map((idx) => {
			if (idx.name && originalSQL.includes(`CREATE UNIQUE INDEX ${idx.name.toUpperCase()}`)) {
				return { ...idx, unique: true }
			}
			return idx
		})
	}

	return indexes
}

/**
 * Convert a create index statement to a structured index definition
 * @param {string|null} defaultSchema - Default schema from search_path
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {Object} Structured index definition
 */
export const indexDefFromStatement = curry((defaultSchema, stmt) => {
	const indexName = extractIndexName(stmt)
	const schema = extractIndexSchema(stmt) || defaultSchema
	const tableName = extractTableName(stmt)
	const tableSchema = extractTableSchema(stmt) || defaultSchema

	return {
		name: indexName,
		schema: schema,
		table: tableName,
		tableSchema: tableSchema,
		unique: !!stmt.unique,
		ifNotExists: !!stmt.if_not_exists,
		columns: extractIndexColumns(stmt)
	}
})

/**
 * Extract index name from a CREATE INDEX statement
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {string} Index name
 */
export const extractIndexName = (stmt) => {
	if (stmt.index?.name) {
		return stmt.index.name
	} else if (stmt.IndexName) {
		return stmt.IndexName
	} else if (stmt.indexname) {
		return stmt.indexname
	} else if (stmt.index) {
		// Handle case where index is a string directly
		if (typeof stmt.index === 'string') {
			return stmt.index
		}
		// Handle case where index is stored in different format
		if (typeof stmt.index === 'object' && stmt.index.value) {
			return stmt.index.value
		}
	}
	return null
}

/**
 * Extract index schema from a CREATE INDEX statement
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {string|null} Index schema or null
 */
export const extractIndexSchema = (stmt) => {
	if (stmt.index?.schema) {
		return stmt.index.schema
	} else if (stmt.schema) {
		return stmt.schema
	}
	return null
}

/**
 * Extract table name from a CREATE INDEX statement
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {string} Table name
 */
export const extractTableName = (stmt) => {
	if (stmt.table?.table) {
		return stmt.table.table
	} else if (stmt.table_name?.[0]?.table) {
		return stmt.table_name[0].table
	} else if (stmt.relationName) {
		return stmt.relationName
	} else if (stmt.on?.[0]?.table) {
		// Handle case where table is in 'on' property
		return stmt.on[0].table
	} else if (typeof stmt.table === 'string') {
		// Handle case where table is a string directly
		return stmt.table
	}
	return null
}

/**
 * Extract table schema from a CREATE INDEX statement
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {string|null} Table schema or null
 */
export const extractTableSchema = (stmt) => {
	if (stmt.table?.schema) {
		return stmt.table.schema
	} else if (stmt.table_name?.[0]?.schema) {
		return stmt.table_name[0].schema
	}
	return null
}

/**
 * Extract index columns from a CREATE INDEX statement
 * @param {Object} stmt - CREATE INDEX statement
 * @returns {Array} Extracted index columns
 */
export const extractIndexColumns = (stmt) => {
	if (!stmt.columns || !Array.isArray(stmt.columns)) return []

	return stmt.columns
		.map((col) => {
			let colName = null
			let colOrder = 'ASC'

			if (col.column?.column?.expr?.value) {
				colName = col.column.column.expr.value
			} else if (col.column?.column) {
				colName = col.column.column
			} else if (col.name) {
				colName = col.name
			} else if (col.expr?.column) {
				colName = col.expr.column
			}

			// Extract ordering if available
			if (col.order) {
				colOrder = col.order.toUpperCase()
			} else if (col.direction) {
				colOrder = col.direction.toUpperCase()
			}

			return {
				name: colName,
				order: colOrder
			}
		})
		.filter((col) => col.name) // Only include columns with names
}

/**
 * Extract indexes from SQL string when AST parsing fails
 * @param {string} sql - Original SQL string
 * @param {string|null} defaultSchema - Default schema
 * @returns {Array} Array of index definitions
 */
export const extractIndexesFromSql = (sql, defaultSchema) => {
	const indexes = []

	// Extract indexes with regex - enhanced to match more formats
	const indexRegex =
		/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?([^\s.(]+)\s+ON\s+(?:(\w+)\.)?(\w+)\s*\(([^)]+)\)/gi

	let match
	while ((match = indexRegex.exec(sql)) !== null) {
		const isUnique = match[1] !== undefined && match[1] !== null
		const indexSchema = match[2] || defaultSchema
		const indexName = match[3]
		const tableSchema = match[4] || defaultSchema
		const tableName = match[5]
		const columnsStr = match[6]

		// Parse column definitions
		const columns = columnsStr.split(',').map((colDef) => {
			const colParts = colDef.trim().split(/\s+/)
			const colName = colParts[0].replace(/["`]/g, '')
			const colOrder =
				colParts.length > 1 && /^(ASC|DESC)$/i.test(colParts[1]) ? colParts[1].toUpperCase() : 'ASC'

			return {
				name: colName,
				order: colOrder === 'DESC' ? 'DESC' : 'ASC'
			}
		})

		indexes.push({
			name: indexName,
			schema: indexSchema,
			table: tableName,
			tableSchema: tableSchema,
			unique: isUnique,
			ifNotExists: sql.toUpperCase().includes('IF NOT EXISTS'),
			columns: columns
		})
	}

	return indexes
}
