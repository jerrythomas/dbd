/**
 * SQL Parser - Functional API
 * @module sql-parser
 */

import { parse, validateSQL } from './parsers/sql.js'
import { normalizeAst } from './transformers/ast.js'
import { extractTables } from './extractors/tables.js'
import { extractViews } from './extractors/views.js'
import { extractProcedures } from './extractors/procedures.js'
import { extractIndexes } from './extractors/db-indexes.js'
import { pipe } from 'ramda'

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

// Export parser APIs
export { parse, normalizeAst, extractTables, extractViews, extractProcedures, extractIndexes }
