/**
 * SQL Parser - Functional API
 * @module sql-parser
 */

import { parse, validateSQL } from './parsers/sql.js'
import { extractTables, extractSearchPaths } from './extractors/tables.js'
import { extractViews } from './extractors/views.js'
import { extractProcedures } from './extractors/procedures.js'
import { extractIndexes } from './extractors/db-indexes.js'
import { extractTriggers } from './extractors/triggers.js'
import { pipe, filter, find } from 'ramda'

/**
 * Extract table definitions from SQL
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Array} Array of table definitions
 */
export const extractTableDefinitions = (sql, options = {}) => {
	const ast = parse(sql, options)
	return extractTables(ast)
}

/**
 * Extract view definitions from SQL
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Array} Array of view definitions
 */
export const extractViewDefinitions = (sql, options = {}) => {
	const ast = parse(sql, options)
	return extractViews(ast)
}

/**
 * Extract procedure definitions from SQL
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Array} Array of procedure definitions
 */
export const extractProcedureDefinitions = (sql, options = {}) => {
	const ast = parse(sql, options)
	return extractProcedures(ast)
}

/**
 * Extract index definitions from SQL
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Array} Array of index definitions
 */
export const extractIndexDefinitions = (sql, options = {}) => {
	const ast = parse(sql, options)
	return extractIndexes(ast)
}

/**
 * Extract complete schema from SQL
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Object} Schema object with tables, views, procedures, and indexes
 */
export const extractSchema = (sql, options = {}) => {
	return {
		tables: extractTableDefinitions(sql, options),
		views: extractViewDefinitions(sql, options),
		procedures: extractProcedureDefinitions(sql, options),
		indexes: extractIndexDefinitions(sql, options)
	}
}

/**
 * Validate SQL DDL
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with valid and message properties
 */
export const validateDDL = (sql, options = {}) => {
	return validateSQL(sql, options)
}

// --- Dependency extraction API ---

/**
 * Identify the primary entity (CREATE statement) from an AST.
 * Returns the first CREATE TABLE/VIEW/FUNCTION/PROCEDURE found.
 * @param {Array} ast - Parsed SQL AST
 * @param {string} sql - Original SQL text (for trigger/fallback detection)
 * @returns {Object|null} {name, schema, type} or null
 */
export const identifyEntity = (ast, sql) => {
	if (!ast || !Array.isArray(ast)) return null

	const createStmt = find(
		(stmt) =>
			stmt.type === 'create' && ['table', 'view', 'procedure', 'function'].includes(stmt.keyword),
		ast
	)

	if (createStmt) {
		const keyword = createStmt.keyword
		let name, schema

		if (keyword === 'table') {
			const tableInfo = createStmt.table?.[0]
			name = tableInfo?.table
			schema = tableInfo?.db || null
		} else if (keyword === 'view') {
			const viewInfo = createStmt.view
			name = viewInfo?.view
			schema = viewInfo?.db || null
		} else if (keyword === 'procedure') {
			const procInfo = createStmt.procedure
			if (typeof procInfo === 'object' && procInfo !== null) {
				name = procInfo.procedure || procInfo.name
				schema = procInfo.schema || null
			} else {
				name = procInfo
			}
		} else if (keyword === 'function') {
			// Function AST uses stmt.name.name[0].value for the name
			const nameInfo = createStmt.name
			if (nameInfo?.name?.[0]) {
				name = nameInfo.name[0].value
				schema = nameInfo.schema || null
			}
		}

		return name ? { name, schema, type: keyword } : null
	}

	// Fallback: try regex for CREATE FUNCTION/PROCEDURE (AST may not parse PL/pgSQL)
	if (sql) {
		const match = sql.match(
			/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:(\w+)\.)?(\w+)/i
		)
		if (match) {
			const keyword = /FUNCTION/i.test(match[0]) ? 'function' : 'procedure'
			return { name: match[2], schema: match[1] || null, type: keyword }
		}
	}

	return null
}

/**
 * Collect all references from parsed entity structures into a flat {name, type} array.
 * @param {Object} parsed - {tables, views, procedures, triggers}
 * @returns {Array<{name: string, type: string|null}>}
 */
export const collectReferences = ({ tables, views, procedures, triggers }) => {
	const refs = []

	// Table FK constraints → references to other tables
	for (const table of tables) {
		for (const col of table.columns || []) {
			for (const constraint of col.constraints || []) {
				if (constraint.type === 'FOREIGN KEY' && constraint.table) {
					const name = constraint.schema
						? `${constraint.schema}.${constraint.table}`
						: constraint.table
					refs.push({ name, type: 'table' })
				}
			}
		}
	}

	// View dependencies → references to tables/views
	for (const view of views) {
		for (const dep of view.dependencies || []) {
			if (dep.type === 'subquery') continue
			if (dep.table) {
				const name = dep.schema ? `${dep.schema}.${dep.table}` : dep.table
				refs.push({ name, type: 'table/view' })
			}
		}
	}

	// Procedure/function body references → tables
	for (const proc of procedures) {
		for (const tableRef of proc.tableReferences || []) {
			refs.push({ name: tableRef, type: 'table/view' })
		}
	}

	// Trigger references → table and execute function
	for (const trigger of triggers) {
		if (trigger.table) {
			const tableName = trigger.tableSchema
				? `${trigger.tableSchema}.${trigger.table}`
				: trigger.table
			refs.push({ name: tableName, type: 'table' })
		}
		if (trigger.executeFunction) {
			refs.push({ name: trigger.executeFunction, type: 'function' })
		}
	}

	// Deduplicate by name
	const seen = new Set()
	return refs.filter((ref) => {
		if (seen.has(ref.name)) return false
		seen.add(ref.name)
		return true
	})
}

/**
 * Extract dependencies from a SQL DDL file.
 *
 * Returns the entity identity, search paths, and all references found via AST parsing.
 * This replaces the regex-based reference extraction with structured AST analysis.
 *
 * @param {string} sql - SQL DDL content
 * @param {Object} options - Parser options
 * @returns {Object} {entity, searchPaths, references}
 */
export const extractDependencies = (sql, options = {}) => {
	const ast = parse(sql, options)
	const tables = extractTables(ast)
	const views = extractViews(ast)
	const procedures = extractProcedures(ast)
	const triggers = extractTriggers(ast, sql)

	return {
		entity: identifyEntity(ast, sql),
		searchPaths: extractSearchPaths(ast),
		references: collectReferences({ tables, views, procedures, triggers })
	}
}

// Export parser APIs
export {
	parse,
	extractTables,
	extractViews,
	extractProcedures,
	extractIndexes,
	extractTriggers,
	extractSearchPaths
}
