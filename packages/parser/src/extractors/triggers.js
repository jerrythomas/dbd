/**
 * Trigger extractor module — regex-based (node-sql-parser does not support CREATE TRIGGER)
 * @module extractors/triggers
 */

import { extractSearchPath } from './tables.js'

/**
 * Regex for CREATE TRIGGER statements.
 *
 * Handles:
 *   CREATE TRIGGER name (BEFORE|AFTER|INSTEAD OF) (INSERT|UPDATE|DELETE|...)
 *     ON [schema.]table FOR EACH ROW EXECUTE (FUNCTION|PROCEDURE) [schema.]func()
 */
const TRIGGER_REGEX =
	/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\w\s,]+?)\s+ON\s+(?:(\w+)\.)?(\w+)\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:(\w+)\.)?(\w+)\s*\(/gi

/**
 * Extract trigger definitions from an AST (uses original SQL since AST doesn't support triggers)
 * @param {Array} ast - Parsed SQL AST (used for search_path)
 * @param {string} sql - Original SQL text
 * @returns {Array} Array of trigger definitions
 */
export const extractTriggers = (ast, sql) => {
	if (!sql || typeof sql !== 'string') return []

	const searchPath = Array.isArray(ast) ? extractSearchPath(ast) : null
	return extractTriggersFromSql(sql, searchPath)
}

/**
 * Extract trigger definitions from raw SQL text
 * @param {string} sql - SQL text
 * @param {string|null} defaultSchema - Default schema from search_path
 * @returns {Array} Array of trigger definitions
 */
export const extractTriggersFromSql = (sql, defaultSchema) => {
	const triggers = []
	const regex = new RegExp(TRIGGER_REGEX.source, TRIGGER_REGEX.flags)

	let match
	while ((match = regex.exec(sql)) !== null) {
		const name = match[1]
		const timing = match[2].replace(/\s+/g, ' ').toUpperCase()
		const events = match[3]
			.split(/\s+OR\s+/i)
			.map((e) => e.trim().toUpperCase())
			.filter(Boolean)
		const tableSchema = match[4] || defaultSchema
		const table = match[5]
		const funcSchema = match[6] || null
		const func = match[7]

		triggers.push({
			name,
			schema: tableSchema,
			table,
			tableSchema,
			timing,
			events,
			executeFunction: funcSchema ? `${funcSchema}.${func}` : func
		})
	}

	return triggers
}
