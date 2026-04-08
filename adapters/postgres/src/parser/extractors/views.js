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
 * Resolve view column name from alias, column, or expression
 * @param {Object} col - Column from AST
 * @returns {string} Resolved column name
 */
const resolveViewColumnName = (col) => {
	if (col.as) return col.as
	if (col.expr.column) return col.expr.column
	if (col.expr.name) return col.expr.name
	return '[EXPRESSION]'
}

/**
 * Resolve view column source from AST node
 * @param {Object} col - Column from AST
 * @returns {Object} Structured source information
 */
const resolveViewColumnSource = (col) => {
	if (col.expr.type === 'column_ref') return { table: col.expr.table, column: col.expr.column }
	if (col.expr.type === 'binary_expr' && col.expr.operator === '->') {
		return {
			type: 'json_extract',
			expression: `${col.expr.left.column} -> ${col.expr.right.value}`
		}
	}
	if (col.expr.type === 'function') {
		return { type: 'function', name: col.expr.name?.name?.[0]?.value || col.expr.name }
	}
	return { type: 'expression' }
}

/**
 * Extract view columns from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {Array} Extracted view columns
 */
export const extractViewColumns = (stmt) => {
	const selectStmt = stmt.select
	if (!selectStmt || !selectStmt.columns) return []
	return selectStmt.columns.map((col) => ({
		name: resolveViewColumnName(col),
		source: resolveViewColumnSource(col)
	}))
}

/**
 * Add a table dependency, skipping CTEs
 * @param {Object} table - Table object from AST
 * @param {Array} dependencies - Dependencies accumulator
 * @param {Set} cteNames - Set of CTE names to exclude
 */
const addViewDependency = (table, dependencies, cteNames) => {
	if (!table || typeof table !== 'object') return
	const tableName = table.table || table.name
	if (cteNames.has(tableName)) return
	dependencies.push({
		table: tableName,
		name: tableName,
		schema: table.db || table.schema,
		alias: table.as || null
	})
}

/**
 * Collect dependencies from FROM clause, including JOINs
 * @param {Array} from - FROM items from AST
 * @param {Array} dependencies - Dependencies accumulator
 * @param {Set} cteNames - Set of CTE names to exclude
 */
const collectFromItems = (from, dependencies, cteNames) => {
	if (!Array.isArray(from)) return
	for (const item of from) {
		if (item.table) addViewDependency(item, dependencies, cteNames)
		else if (item.expr) dependencies.push({ type: 'subquery' })
		if (item.join) addViewDependency(item.join, dependencies, cteNames)
	}
}

/**
 * Extract view dependencies from a CREATE VIEW statement
 * @param {Object} stmt - CREATE VIEW statement
 * @returns {Array} Extracted dependencies
 */
export const extractViewDependencies = (stmt) => {
	if (!stmt.select || !stmt.select.from) return []

	const cteNames = new Set()
	if (stmt.select.with && Array.isArray(stmt.select.with)) {
		for (const cte of stmt.select.with) {
			const name = cte.name?.value || cte.name
			if (name) cteNames.add(name)
		}
	}

	const dependencies = []

	if (stmt.select.with && Array.isArray(stmt.select.with)) {
		for (const cte of stmt.select.with) {
			if (cte.stmt?.from) collectFromItems(cte.stmt.from, dependencies, cteNames)
		}
	}

	collectFromItems(stmt.select.from, dependencies, cteNames)
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
