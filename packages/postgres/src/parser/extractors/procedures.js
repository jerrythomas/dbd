/**
 * Procedures extractor module
 * @module extractors/procedures
 */

import { pipe, filter, map, curry, prop, propEq, find, assoc } from 'ramda'
import { extractSearchPath } from './tables.js'

const isRoutineStmt = (stmt) =>
	stmt.type === 'create' && (stmt.keyword === 'procedure' || stmt.keyword === 'function')

/**
 * Extract all procedure and function definitions from an AST
 * @param {Array} ast - Parsed SQL AST
 * @returns {Array} Extracted procedure/function definitions
 */
export const extractProcedures = (ast) => {
	if (!ast || !Array.isArray(ast)) return []

	// Find search_path if it exists
	const searchPath = extractSearchPath(ast)

	// Extract procedures/functions from AST
	const procedures = pipe(filter(isRoutineStmt), map(procDefFromStatement(searchPath)))(ast)

	// Check if we have any procedure/function with original statement
	const proceduresFromOriginal = pipe(
		filter((stmt) => isRoutineStmt(stmt) && stmt.original),
		map((stmt) => extractProcedureFromOriginal(stmt.original, searchPath))
	)(ast)

	if (proceduresFromOriginal.length > 0) {
		return proceduresFromOriginal
	}

	// Extract procedures/functions from SQL text if AST parsing failed
	if (procedures.length === 0 && ast._original_sql) {
		return extractRoutinesFromSql(ast._original_sql, searchPath)
	}

	return procedures
}

/**
 * Convert a create procedure statement to a structured procedure definition
 * @param {string|null} defaultSchema - Default schema from search_path
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {Object} Structured procedure definition
 */
export const procDefFromStatement = curry((defaultSchema, stmt) => {
	const procedureName = extractProcedureName(stmt)
	const schema = extractProcedureSchema(stmt) || defaultSchema
	const isReplace = extractIsReplace(stmt)
	const body = extractProcedureBody(stmt)

	// For functions with AST-parsed bodies, extract references from AST
	// For procedures with raw body text, use regex-based extraction
	const tableReferences = body
		? extractTableReferencesFromBody(body)
		: extractBodyReferencesFromAst(stmt)

	return {
		name: procedureName,
		schema: schema,
		replace: isReplace,
		language: extractProcedureLanguage(stmt),
		parameters: extractProcedureParameters(stmt),
		returnType: extractProcedureReturnType(stmt),
		body: body,
		tableReferences
	}
})

/**
 * Extract procedure/function name from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {string} Procedure/function name
 */
export const extractProcedureName = (stmt) => {
	// Function AST uses stmt.name.name[0].value
	if (stmt.keyword === 'function' && stmt.name?.name?.[0]) {
		return stmt.name.name[0].value
	}
	if (typeof stmt.procedure === 'object' && stmt.procedure !== null) {
		return stmt.procedure.procedure || stmt.procedure.name
	}
	return stmt.procedure || ''
}

/**
 * Extract procedure/function schema from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {string|null} Procedure/function schema or null
 */
export const extractProcedureSchema = (stmt) => {
	// Function AST uses stmt.name.schema
	if (stmt.keyword === 'function' && stmt.name) {
		return stmt.name.schema || null
	}
	if (typeof stmt.procedure === 'object' && stmt.procedure !== null) {
		return stmt.procedure.schema
	}
	return stmt.schema || null
}

/**
 * Extract if the procedure is a CREATE OR REPLACE PROCEDURE
 * @param {Object} stmt - CREATE PROCEDURE statement
 * @returns {boolean} True if it's a REPLACE procedure
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
 * Extract procedure/function language from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {string} Procedure/function language
 */
export const extractProcedureLanguage = (stmt) => {
	if (stmt.language) return stmt.language
	// Function AST stores language in options array
	if (stmt.options && Array.isArray(stmt.options)) {
		const langOpt = stmt.options.find((o) => o.prefix === 'LANGUAGE')
		if (langOpt) return langOpt.value
	}
	return 'plpgsql'
}

/**
 * Extract procedure/function parameters from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {Array} Extracted procedure/function parameters
 */
export const extractProcedureParameters = (stmt) => {
	// Function AST uses stmt.args
	const params = stmt.parameters || stmt.args
	if (!params || !Array.isArray(params)) {
		return []
	}

	return params.map((param) => ({
		name: param.name,
		dataType: extractParameterDataType(param),
		mode: extractParameterMode(param)
	}))
}

/**
 * Extract parameter data type
 * @param {Object} param - Parameter definition
 * @returns {string} Data type
 */
export const extractParameterDataType = (param) => {
	if (param.dataType) {
		if (typeof param.dataType === 'string') {
			return param.dataType.toLowerCase()
		} else if (param.dataType.dataType) {
			return param.dataType.dataType.toLowerCase()
		}
	}
	return 'unknown'
}

/**
 * Extract parameter mode (IN, OUT, INOUT)
 * @param {Object} param - Parameter definition
 * @returns {string} Parameter mode
 */
export const extractParameterMode = (param) => {
	if (param.mode) {
		return param.mode.toLowerCase()
	}
	return 'in' // Default is IN
}

/**
 * Extract procedure/function return type from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {string|Object|null} Return type or null
 */
export const extractProcedureReturnType = (stmt) => {
	return stmt.returns || null
}

/**
 * Extract procedure/function body from a CREATE PROCEDURE/FUNCTION statement
 * @param {Object} stmt - CREATE PROCEDURE/FUNCTION statement
 * @returns {string} Procedure/function body (raw text)
 */
export const extractProcedureBody = (stmt) => {
	if (stmt.as) return stmt.as
	// Function AST doesn't store raw body text — return empty string
	// Body references are extracted via extractBodyReferencesFromAst instead
	return ''
}

/**
 * Extract table references from a function's parsed AST body.
 * When the parser successfully parses a function body, the statements
 * are available as AST nodes in stmt.options[].expr (where type === 'as').
 * @param {Object} stmt - CREATE FUNCTION AST statement
 * @returns {Array} Array of table name strings (e.g. ['schema.table'])
 */
export const extractBodyReferencesFromAst = (stmt) => {
	if (!stmt.options || !Array.isArray(stmt.options)) return []

	const tables = new Set()
	const asOpt = stmt.options.find((o) => o.type === 'as')
	if (!asOpt || !asOpt.expr || !Array.isArray(asOpt.expr)) return []

	const collectTables = (node) => {
		if (!node || typeof node !== 'object') return
		// Direct table reference in a statement
		if (node.table && Array.isArray(node.table)) {
			for (const t of node.table) {
				if (t.table) {
					const name = t.db ? `${t.db}.${t.table}` : t.table
					tables.add(name)
				}
			}
		}
		// FROM clauses
		if (node.from && Array.isArray(node.from)) {
			for (const f of node.from) {
				if (f.table) {
					const name = f.db ? `${f.db}.${f.table}` : f.table
					tables.add(name)
				}
			}
		}
	}

	for (const expr of asOpt.expr) {
		collectTables(expr)
	}

	return Array.from(tables)
}

/**
 * Extract tables referenced in procedure body
 * @param {string} body - Procedure body
 * @returns {Array} Array of table names
 */
export const extractTableReferencesFromBody = (body) => {
	if (!body || typeof body !== 'string') return []

	// Strip comments and string literals before extracting references
	const cleanBody = body
		.replace(/--[^\n]*(\n|$)/g, '\n') // line comments
		.replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
		.replace(/'[^']*'/g, "''") // string literals

	const tables = new Set()

	// SQL keywords that precede table names (not variable assignments)
	// Note: bare 'INTO' is excluded — in PL/pgSQL, 'SELECT ... INTO var' assigns to variables.
	// Only 'INSERT INTO table' references a real table.
	const sqlKeywords = [
		'INSERT INTO',
		'DELETE FROM',
		'ALTER TABLE',
		'CREATE TABLE',
		'FROM',
		'JOIN',
		'UPDATE'
	]

	// Create a regex pattern that matches all keywords
	const pattern = new RegExp(`(${sqlKeywords.join('|')})\\s+([\\w"\\.]+)`, 'gi')

	// SQL keywords and PL/pgSQL keywords that should not be treated as table names
	const nonTableWords =
		/^(SELECT|WHERE|GROUP|ORDER|HAVING|UNION|AND|OR|AS|SET|STRICT|NEW|OLD|IF|THEN|ELSE|ELSIF|END|LOOP|RETURN|RAISE|PERFORM|EXECUTE|DECLARE|BEGIN|EXCEPTION|FOUND|NULL|TRUE|FALSE|NOT|IS|IN|EXISTS|CASE|WHEN|USING|WITH)$/i

	let match
	while ((match = pattern.exec(cleanBody)) !== null) {
		const potentialTable = match[2].replace(/"/g, '') // Remove quotes

		if (potentialTable && !nonTableWords.test(potentialTable.split('.').pop())) {
			tables.add(potentialTable)
		}
	}

	return Array.from(tables)
}

/**
 * Extract procedure/function from original statement string
 * @param {string} originalStmt - Original statement
 * @param {string|null} defaultSchema - Default schema
 * @returns {Object} Procedure/function definition
 */
export const extractProcedureFromOriginal = (originalStmt, defaultSchema) => {
	const routines = extractRoutinesFromSql(originalStmt, defaultSchema)
	return routines.length > 0 ? routines[0] : null
}

/** @deprecated Use extractRoutinesFromSql instead */
export const extractProceduresFromSql = (sql, defaultSchema) =>
	extractRoutinesFromSql(sql, defaultSchema)

/**
 * Parse a raw parameter string into structured parameter object
 * @param {string} paramStr - Parameter string (e.g., "IN param_name text" or "param_name integer")
 * @returns {Object} Structured parameter with mode, name, dataType
 */
const parseRawParameter = (paramStr) => {
	const paramParts = paramStr.trim().split(/\s+/)
	if (/^IN(OUT)?$/i.test(paramParts[0]) || /^OUT$/i.test(paramParts[0])) {
		return {
			mode: paramParts[0].toLowerCase(),
			name: paramParts[1],
			dataType: paramParts.slice(2).join(' ').toLowerCase()
		}
	}
	return {
		mode: 'in',
		name: paramParts[0],
		dataType: paramParts.slice(1).join(' ').toLowerCase()
	}
}

/**
 * Extract procedures and functions from SQL string when AST parsing fails
 * @param {string} sql - Original SQL string
 * @param {string|null} defaultSchema - Default schema
 * @returns {Array} Array of procedure/function definitions
 */
export const extractRoutinesFromSql = (sql, defaultSchema) => {
	const procedures = []

	// Extract procedures and functions with regex
	const procRegex =
		/CREATE\s+(OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION)\s+(?:(\w+)\.)?(\w+)\s*\(([^)]*)\)(?:\s+RETURNS\s+([^\s]+))?(?:\s+LANGUAGE\s+(\w+))?\s+AS\s+(?:\$\w*\$([\s\S]*?)\$\w*\$|'([\s\S]*?)')/gi

	let match
	while ((match = procRegex.exec(sql)) !== null) {
		const isReplace = !!match[1]
		const schema = match[2] || defaultSchema
		const procName = match[3]
		const params = match[4]
		const returnType = match[5] || null
		const language = match[6]?.toLowerCase() || 'plpgsql'
		const body = match[7] || match[8]

		// Parse parameters
		const parameters = params.split(',').filter(Boolean).map(parseRawParameter)

		procedures.push({
			name: procName,
			schema,
			replace: isReplace,
			language,
			parameters,
			returnType,
			body,
			tableReferences: extractTableReferencesFromBody(body)
		})
	}

	return procedures
}
