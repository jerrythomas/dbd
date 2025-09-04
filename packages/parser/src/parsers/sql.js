/**
 * SQL parsing utilities
 * @module parsers/sql
 */

import { pipe, tryCatch, always } from 'ramda'
import pkg from 'node-sql-parser'
import errorHandler from '../utils/error-handler.js'

const { Parser } = pkg

/**
 * Create a parser instance for the specified SQL dialect
 * @param {string} dialect - SQL dialect to use
 * @returns {Object} Parser instance
 */
const createParser = (dialect = 'PostgreSQL') => new Parser()

/**
 * Split SQL string into individual statements
 * @param {string} sql - SQL string to split
 * @returns {Array<string>} Array of SQL statements
 */
export const splitStatements = (sql) => {
	const statements = []
	let current = ''
	let inString = false // Track if we're inside a string
	let stringChar = '' // The string delimiter character (' or ")
	let inComment = false // Track if we're inside a comment
	let commentType = '' // The comment type (-- or /* */)
	let inDollarString = false // Track if we're inside a Postgres dollar-quoted string
	let dollarTag = '' // The dollar tag (e.g., $function$ or $$)
	let i = 0

	while (i < sql.length) {
		const char = sql[i]
		const nextChar = sql[i + 1] || ''
		const prevChar = i > 0 ? sql[i - 1] : ''

		// Check for comment start/end
		if (!inString && !inDollarString && !inComment && char === '-' && nextChar === '-') {
			inComment = true
			commentType = '--'
			current += char + nextChar
			i += 2
			continue
		}

		if (!inString && !inDollarString && !inComment && char === '/' && nextChar === '*') {
			inComment = true
			commentType = '/*'
			current += char + nextChar
			i += 2
			continue
		}

		// Check for comment end
		if (inComment) {
			if (commentType === '--' && char === '\n') {
				inComment = false
			} else if (commentType === '/*' && char === '*' && nextChar === '/') {
				inComment = false
				current += char + nextChar
				i += 2
				continue
			}
		}

		// Check for string delimiters
		if (!inComment && !inDollarString && (char === "'" || char === '"')) {
			if (!inString) {
				inString = true
				stringChar = char
			} else if (char === stringChar && prevChar !== '\\') {
				inString = false
			}
		}

		// Check for dollar-quoted string (PostgreSQL feature)
		if (!inComment && !inString && char === '$') {
			if (!inDollarString) {
				// Find the end of the tag
				let end = i + 1
				while (end < sql.length && sql[end] !== '$') {
					end++
				}

				if (sql[end] === '$') {
					inDollarString = true
					dollarTag = sql.substring(i, end + 1)
					current += dollarTag
					i = end + 1
					continue
				}
			} else {
				// Check if we're at the end of a dollar-quoted string
				const potentialEndTag = sql.substring(i, i + dollarTag.length)
				if (potentialEndTag === dollarTag) {
					inDollarString = false
					current += dollarTag
					i += dollarTag.length
					continue
				}
			}
		}

		// Only check for semicolons when not in a string, comment, or dollar-quoted string
		if (!inString && !inComment && !inDollarString && char === ';') {
			if (current.trim()) {
				statements.push(current.trim())
			}
			current = ''
			i++
			continue
		}

		// Add the current character to the current statement
		current += char
		i++
	}

	// Add the last statement if there is one
	if (current.trim()) {
		statements.push(current.trim())
	}

	return statements
}

/**
 * Parse a single SQL statement into an AST
 * @param {string} statement - SQL statement to parse
 * @param {Object} options - Parser options
 * @returns {Object|Array} AST representation of the SQL statement
 */
export const parseSingleStatement = (statement, options = {}) => {
	const parser = createParser(options.dialect)
	const parsedStatement = parser.astify(statement, options)

	return parsedStatement
}

/**
 * Safe parser that won't throw exceptions
 * @param {string} statement - SQL statement to parse
 * @param {Object} options - Parser options
 * @returns {Object|Array} AST representation or empty array on error
 */
export const safeParseSingleStatement = tryCatch(parseSingleStatement, (err, statement) => {
	errorHandler.handleParsingError(err, statement, 'single statement parsing')
	return [] // Return empty array on error
})

/**
 * Parse SQL string into AST
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options
 * @returns {Array} AST representation of the SQL
 */
export const parse = (sql, options = {}) => {
	// Default options
	const parserOptions = {
		database: options.dialect || 'PostgreSQL',
		...options
	}

	// Split SQL into statements
	const statements = splitStatements(sql)

	// Parse each statement
	const parsedStatements = statements
		.flatMap((stmt) => {
			// Special handling for SET search_path
			if (stmt.trim().toUpperCase().startsWith('SET SEARCH_PATH')) {
				return parseSearchPath(stmt)
			}

			// Skip parsing for procedure statements if they're not well supported
			if (
				stmt.trim().toUpperCase().startsWith('CREATE PROCEDURE') ||
				stmt.trim().toUpperCase().startsWith('CREATE OR REPLACE PROCEDURE')
			) {
				try {
					return safeParseSingleStatement(stmt, parserOptions)
				} catch (err) {
					// We'll handle procedures in a special way in the extractors
					errorHandler.handleParsingError(err, stmt, 'procedure parsing')
					return [
						{
							type: 'create',
							keyword: 'procedure',
							original: stmt
						}
					]
				}
			}

			// Special handling for CREATE INDEX statements
			if (
				stmt.trim().toUpperCase().startsWith('CREATE INDEX') ||
				stmt.trim().toUpperCase().startsWith('CREATE UNIQUE INDEX')
			) {
				try {
					const result = safeParseSingleStatement(stmt, parserOptions)
					if (Array.isArray(result) && result.length === 0) {
						// If parsing failed, create a simple representation
						const isUnique = stmt.trim().toUpperCase().startsWith('CREATE UNIQUE INDEX')
						return [
							{
								type: 'create',
								keyword: 'index',
								unique: isUnique,
								original: stmt
							}
						]
					}
					return result
				} catch (err) {
					errorHandler.handleParsingError(err, stmt, 'index parsing')
					return [
						{
							type: 'create',
							keyword: 'index',
							unique: stmt.trim().toUpperCase().includes('UNIQUE'),
							original: stmt
						}
					]
				}
			}

			// Regular statement parsing
			return safeParseSingleStatement(stmt, parserOptions)
		})
		.filter(Boolean)

	// Add original statements for reference
	const result = parsedStatements.map((stmt, i) => {
		if (typeof stmt === 'object' && stmt !== null) {
			stmt.originalStatement = statements[i]
		}
		return stmt
	})

	// Add the original SQL for reference
	result._original_sql = sql

	return result
}

/**
 * Parse SET search_path statement
 * @param {string} stmt - SET search_path statement
 * @returns {Object} Parsed statement
 */
export const parseSearchPath = (stmt) => {
	const regex = /SET\s+search_path\s+(?:TO\s+)?(.+?)(;|\s*$)/i
	const match = regex.exec(stmt)

	if (!match) return []

	const value = match[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	return [
		{
			type: 'set',
			variable: 'search_path',
			value
		}
	]
}

/**
 * Validate SQL without throwing errors
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Parser options
 * @returns {Object} Validation result
 */
export const validateSQL = (sql, options = {}) => {
	// Use error handler with logging disabled for validation
	return errorHandler.withConfig(
		() => {
			try {
				const parsedStatements = parse(sql, options)
				const valid = Array.isArray(parsedStatements) && parsedStatements.length > 0
				const errors = errorHandler.getErrors()

				// For backward compatibility, we still return valid=true even if there are parsing errors
				// as long as we were able to extract something from the SQL
				return {
					valid: valid, // Only check if we have statements, ignore errors
					message: valid ? 'Valid SQL' : 'Error: Invalid or unsupported SQL',
					errors: errors
				}
			} catch (err) {
				errorHandler.handleParsingError(err, sql, 'validation')
				return {
					valid: false,
					message: `Error: ${err.message}`,
					errors: errorHandler.getErrors()
				}
			}
		},
		{ logToConsole: false, collectErrors: true }
	)
}
