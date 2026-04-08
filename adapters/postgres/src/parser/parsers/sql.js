/**
 * SQL parsing utilities — powered by pgsql-parser (PostgreSQL C parser via WASM)
 * @module parsers/sql
 */

import { loadModule, parseSync } from 'pgsql-parser'
import errorHandler from '../utils/error-handler.js'
import { translatePgStmt } from '../translators/index.js'

/** Module initialization — must be awaited before parsing */
let moduleLoaded = false
const ensureModule = async () => {
	if (!moduleLoaded) {
		await loadModule()
		moduleLoaded = true
	}
}

// Eagerly start loading the WASM module
const moduleReady = ensureModule()

// ─── splitStatements helpers ─────────────────────────────────────────────────

/**
 * Scan forward from position i to find a complete dollar-tag (e.g. $body$).
 * Returns { tag, end } where end is the index of the closing '$', or null.
 */
const scanDollarTag = (sql, i) => {
	let end = i + 1
	while (end < sql.length && sql[end] !== '$') end++
	if (sql[end] !== '$') return null
	return { tag: sql.substring(i, end + 1), end }
}

/**
 * Split SQL string into individual statements.
 * Handles strings, dollar-quoted bodies, and line / block comments.
 * @param {string} sql - SQL string to split
 * @returns {Array<string>} Array of SQL statements
 */
export const splitStatements = (sql) => {
	const statements = []
	let current = ''
	let inString = false
	let stringChar = ''
	let inComment = false
	let commentType = ''
	let inDollarString = false
	let dollarTag = ''
	let i = 0

	while (i < sql.length) {
		const char = sql[i]
		const nextChar = sql[i + 1] || ''
		const prevChar = i > 0 ? sql[i - 1] : ''

		// Comment start
		if (!inString && !inDollarString && !inComment) {
			if (char === '-' && nextChar === '-') {
				inComment = true
				commentType = '--'
				current += char + nextChar
				i += 2
				continue
			}
			if (char === '/' && nextChar === '*') {
				inComment = true
				commentType = '/*'
				current += char + nextChar
				i += 2
				continue
			}
		}

		// Comment end
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

		// String toggle
		if (!inComment && !inDollarString && (char === "'" || char === '"')) {
			if (!inString) {
				inString = true
				stringChar = char
			} else if (char === stringChar && prevChar !== '\\') {
				inString = false
			}
		}

		// Dollar-string handling
		if (!inComment && !inString && char === '$') {
			if (!inDollarString) {
				const found = scanDollarTag(sql, i)
				if (found) {
					inDollarString = true
					dollarTag = found.tag
					current += dollarTag
					i = found.end + 1
					continue
				}
			} else {
				const potentialEndTag = sql.substring(i, i + dollarTag.length)
				if (potentialEndTag === dollarTag) {
					inDollarString = false
					current += dollarTag
					i += dollarTag.length
					continue
				}
			}
		}

		// Statement separator
		if (!inString && !inComment && !inDollarString && char === ';') {
			if (current.trim()) statements.push(current.trim())
			current = ''
			i++
			continue
		}

		current += char
		i++
	}

	if (current.trim()) statements.push(current.trim())
	return statements
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse SQL string into normalized AST.
 * Uses pgsql-parser (PostgreSQL C parser) for accurate parsing,
 * then translates the AST into the shape expected by extractors.
 *
 * @param {string} sql - SQL string to parse
 * @param {Object} options - Parser options (kept for API compat)
 * @returns {Array} Normalized AST representation of the SQL
 */
export const parse = (sql, options = {}) => {
	if (!sql || typeof sql !== 'string' || !sql.trim()) {
		const result = []
		result._original_sql = sql
		return result
	}

	// Try parsing the full SQL first (fastest path)
	try {
		const parsed = parseSync(sql)
		const result = parsed.stmts.map((pgStmt) => translatePgStmt(pgStmt, sql)).filter(Boolean)
		result._original_sql = sql
		return result
	} catch {
		// Full parse failed — fall back to statement-by-statement parsing
	}

	// Statement-level error isolation
	const statements = splitStatements(sql)
	const result = []

	for (const stmt of statements) {
		try {
			const parsed = parseSync(stmt)
			for (const pgStmt of parsed.stmts) {
				const translated = translatePgStmt(pgStmt, sql)
				if (translated) result.push(translated)
			}
		} catch (err) {
			errorHandler.handleParsingError(err, stmt, 'statement parsing')
		}
	}

	result._original_sql = sql
	return result
}

/**
 * Parse SET search_path statement (kept for backward compatibility)
 * @param {string} stmt - SET search_path statement
 * @returns {Array} Parsed statement
 */
export const parseSearchPath = (stmt) => {
	const match = stmt.match(/SET\s+search_path\s+(?:TO\s+)?(.+?)(;|\s*$)/i)
	if (!match) return []

	const value = match[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	return [{ type: 'set', variable: 'search_path', value }]
}

/**
 * Validate SQL without throwing errors
 * @param {string} sql - SQL string to validate
 * @param {Object} options - Parser options
 * @returns {Object} Validation result
 */
export const validateSQL = (sql, options = {}) => {
	return errorHandler.withConfig(
		() => {
			const parsedStatements = parse(sql, options)
			const valid = Array.isArray(parsedStatements) && parsedStatements.length > 0
			const errors = errorHandler.getErrors()
			return {
				valid,
				message: valid ? 'Valid SQL' : 'Error: Invalid or unsupported SQL',
				errors
			}
		},
		{ logToConsole: false, collectErrors: true }
	)
}

/**
 * Initialize the pgsql-parser WASM module.
 * Call this at application startup for slightly faster first parse.
 */
export const initParser = () => moduleReady
