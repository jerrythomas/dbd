import { parse, validateSQL } from './parsers/sql.js'
import { extractTables } from './extractors/tables.js'
import { extractViews } from './extractors/views.js'
import { extractProcedures } from './extractors/procedures.js'
import { extractIndexes } from './extractors/db-indexes.js'

/**
 * Utility class to parse SQL DDL and extract metadata.
 * Wraps the functional API from parsers/sql.js for convenience.
 */
export class SQLParser {
	constructor(dialect = 'PostgreSQL') {
		this.options = { database: dialect }
	}

	/**
	 * Parse SQL statements and return normalized AST
	 * @param {string} sql - SQL string to parse
	 * @returns {Array} - Array of normalized AST objects
	 */
	parse(sql) {
		return parse(sql, this.options)
	}

	/**
	 * Extract table definitions from SQL AST
	 * @param {Array} ast - AST from parser
	 * @returns {Array} - Array of table definitions
	 */
	extractTableDefinitions(ast) {
		return extractTables(ast)
	}

	/**
	 * Extract view definitions from SQL AST
	 * @param {Array} ast - AST from parser
	 * @returns {Array} - Array of view definitions
	 */
	extractViewDefinitions(ast) {
		return extractViews(ast)
	}

	/**
	 * Extract procedure definitions from SQL AST
	 * @param {Array} ast - AST from parser
	 * @returns {Array} - Array of procedure definitions
	 */
	extractProcedureDefinitions(ast) {
		return extractProcedures(ast)
	}

	/**
	 * Extract index definitions from SQL AST
	 * @param {Array} ast - AST from parser
	 * @returns {Array} - Array of index definitions
	 */
	extractIndexDefinitions(ast) {
		return extractIndexes(ast)
	}

	/**
	 * Extract a complete database schema from SQL
	 * @param {string} sql - SQL string containing DDL statements
	 * @returns {Object} - Database schema object
	 */
	extractSchema(sql) {
		const ast = this.parse(sql)

		return {
			tables: this.extractTableDefinitions(ast),
			views: this.extractViewDefinitions(ast),
			procedures: this.extractProcedureDefinitions(ast),
			indexes: this.extractIndexDefinitions(ast)
		}
	}

	/**
	 * Validate SQL DDL syntax and report errors
	 * @param {string} sql - SQL string to validate
	 * @returns {Object} - Validation result with valid flag and error details
	 */
	validateDDL(sql) {
		return validateSQL(sql, this.options)
	}
}

/**
 * Validate SQL DDL syntax and report errors
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Options for validation
 * @returns {Object} - Validation result with valid flag and error details
 */
export function validateDDL(sql, options = {}) {
	return validateSQL(sql, options)
}
