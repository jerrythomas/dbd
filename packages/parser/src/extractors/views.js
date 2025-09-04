/**
 * View extractor module
 * @module extractors/view
 */

import { pipe, filter, map, curry, prop, propEq, find, assoc } from 'ramda'
import { extractSearchPath } from './tables.js'

/**
 * Extract all view definitions from an AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Array} Extracted view definitions
 */
export const extractViews = (ast) => {
	if (!ast || !Array.isArray(ast)) return []

	// Find search_path if it exists
	const searchPath = extractSearchPath(ast)

	// Extract views
	const views = pipe(
		filter((stmt) => stmt.type === 'create' && stmt.keyword === 'view'),
		map(viewDefFromStatement(searchPath))
	)(ast)

	// Extract views from SQL text if AST parsing failed
	if (views.length === 0 && ast._original_sql) {
		return extractViewsFromSql(ast._original_sql, searchPath)
	}

	return views
}

/**
 * Convert a create view statement to a structured view definition
 * @param {string|null} defaultSchema - Default schema from search_path
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {Object} Structured view definition
 */
export const viewDefFromStatement = curry((defaultSchema, stmt) => {
	const viewName = extractViewName(stmt)
	const schema = extractViewSchema(stmt) || defaultSchema
	const isReplace = extractIsReplace(stmt)

	return {
		name: viewName,
		schema: schema,
		replace: isReplace,
		columns: extractViewColumns(stmt),
		dependencies: extractViewDependencies(stmt),
		definition: extractViewDefinition(stmt)
	}
})

/**
 * Extract view name from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {string} View name
 */
export const extractViewName = (stmt) => {
	if (typeof stmt.view === 'object' && stmt.view !== null) {
		if (stmt.view.view) {
			return stmt.view.view
		} else if (stmt.view.table) {
			return stmt.view.table
		}
	}
	return stmt.view || ''
}

/**
 * Extract view schema from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {string|null} View schema or null
 */
export const extractViewSchema = (stmt) => {
	if (typeof stmt.view === 'object' && stmt.view !== null) {
		return stmt.view.schema || stmt.view.db
	}
	return stmt.schema || null
}

/**
 * Extract if the view is a CREATE OR REPLACE VIEW
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {boolean} True if it's a REPLACE view
 */
export const extractIsReplace = (stmt) => {
	if (stmt.replace === 'or replace') {
		return true
	} else if (typeof stmt.replace === 'boolean') {
		return stmt.replace
	} else if (stmt.or_replace) {
		return true
	}
	return false
}

/**
 * Extract view columns from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {Array} Extracted view columns
 */
export const extractViewColumns = (stmt) => {
	const selectStmt = stmt.select
	if (!selectStmt || !selectStmt.columns) return []

	return selectStmt.columns.map((col) => {
		let name, source

		// Handle column alias
		if (col.as) {
			name = col.as
		} else if (col.expr.column) {
			name = col.expr.column
		} else if (col.expr.name) {
			name = col.expr.name
		} else {
			name = '[EXPRESSION]'
		}

		// Handle column source
		if (col.expr.type === 'column_ref') {
			source = {
				table: col.expr.table,
				column: col.expr.column
			}
		} else if (col.expr.type === 'binary_expr' && col.expr.operator === '->') {
			// JSONB operator extraction
			source = {
				type: 'json_extract',
				expression: `${col.expr.left.column} -> ${col.expr.right.value}`
			}
		} else if (col.expr.type === 'function') {
			source = {
				type: 'function',
				name: col.expr.name?.name?.[0]?.value || col.expr.name
			}
		} else {
			source = {
				type: 'expression'
			}
		}

		return { name, source }
	})
}

/**
 * Extract view dependencies from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {Array} Extracted dependencies
 */
export const extractViewDependencies = (stmt) => {
	if (!stmt.select || !stmt.select.from) return []

	const dependencies = []
	const addDependency = (table) => {
		if (table && typeof table === 'object') {
			dependencies.push({
				table: table.table || table.name,
				schema: table.db || table.schema
			})
		}
	}

	const from = stmt.select.from

	// Handle simple FROM tables
	if (Array.isArray(from)) {
		from.forEach((item) => {
			if (item.table) {
				addDependency(item)
			} else if (item.expr) {
				// Subquery - could recursively extract but for now just mark as expression
				dependencies.push({ type: 'subquery' })
			}
		})
	}

	// Handle JOINs
	if (Array.isArray(from)) {
		from.forEach((item) => {
			if (item.join) {
				addDependency(item.join)
			}
		})
	}

	return dependencies
}

/**
 * Extract SQL definition from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {string} SQL definition of the view
 */
export const extractViewDefinition = (stmt) => {
	if (stmt.select && stmt._original_sql) {
		// Try to extract from original SQL
		const viewRegex = new RegExp(
			`CREATE\\s+(OR\\s+REPLACE\\s+)?VIEW\\s+(?:\\w+\\.)?${extractViewName(stmt)}\\s+AS\\s+(.+?)(?:;|$)`,
			'is'
		)
		const match = viewRegex.exec(stmt._original_sql)
		if (match && match[2]) {
			return match[2].trim()
		}
	}

	// Fallback - generate from AST
	return 'SELECT ...'
}

/**
 * Extract views from SQL string when AST parsing fails
 * @param {string} sql - Original SQL string
 * @param {string|null} defaultSchema - Default schema
 * @returns {Array} Array of view definitions
 */
export const extractViewsFromSql = (sql, defaultSchema) => {
	const views = []

	// Extract views with regex
	const viewRegex = /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+(?:(\w+)\.)?(\w+)\s+AS\s+(.+?)(?:;|$)/gis

	let match
	while ((match = viewRegex.exec(sql)) !== null) {
		const isReplace = !!match[1]
		const schema = match[2] || defaultSchema
		const viewName = match[3]
		const definition = match[4].trim()

		views.push({
			name: viewName,
			schema,
			replace: isReplace,
			columns: [], // Would need SQL parsing to extract columns
			dependencies: [], // Would need SQL parsing to extract dependencies
			definition
		})
	}

	return views
}
