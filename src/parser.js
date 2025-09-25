import fs from 'fs'
import { pick, uniq } from 'ramda'
import { allowedTypes } from './constants.js'
import { isInternal } from './exclusions.js'

/**
 * Removes SQL comment blocks from a script.
 * This preprocesses SQL to remove comment on statements
 * that might interfere with parsing.
 * @param {string} sqlScript - The SQL script.
 * @returns {string} SQL script with comment blocks removed.
 */
export function removeCommentBlocks(sqlScript) {
	// Replace "comment on" blocks with placeholders
	// Handle both single and double quotes in comments
	const commentOnRegex = /comment\s+on\s+.*\s+is\s*('[^']*'|"[^"]*");/gis

	// Also handle SQL comments that might contain parentheses
	const lineCommentRegex = /--[^\n]*(\n|$)/g
	const blockCommentRegex = /\/\*[\s\S]*?\*\//g

	// Apply all replacements
	return sqlScript
		.replace(commentOnRegex, '-- COMMENT_PLACEHOLDER;')
		.replace(lineCommentRegex, '\n')
		.replace(blockCommentRegex, ' ')
}

const TYPES_GROUP = '(?<type>procedure|function|view|table)'
const SCHEMA_GROUP = '((?<schema>[a-zA-Z_][a-zA-Z0-9_]+)?\\.)?'
const ENTITY_GROUP = '(?<name>[a-zA-Z_][a-zA-Z0-9_]+)'
const TABLE_ALIAS_PATTERN = '(\\s*((as\\s+)?(?<alias>[a-zA-Z_][a-zA-Z0-9_]*))?)'
const TRIGGER_PATTERN = '\\s+trigger\\s+.*\\s+on\\s+(?<name>[a-zA-Z_][a-zA-Z0-9_.]*)\\s+'
const CREATE_ENTITY_PATTERN =
	'create\\s+(or\\s+replace\\s+)?' +
	TYPES_GROUP +
	'\\s*(if\\s+not\\s+exists\\s+)?' +
	SCHEMA_GROUP +
	ENTITY_GROUP
const FUNCTION_CALL_PATTERN = '\\b(?<prefix>.*?)' + SCHEMA_GROUP + ENTITY_GROUP + '\\s*\\('
const TABLE_REF_PATTERN =
	'\\b(?<extra>.*)?(?<prefix>from|inner\\s+join|cross\\s+join|outer\\s+join|join)\\s+' +
	SCHEMA_GROUP +
	ENTITY_GROUP +
	TABLE_ALIAS_PATTERN

const PATTERNS = {
	ALIAS_TYPE: /(\s+(as|recursive)\s+)$/i,
	TABLE_TYPE: /\b(from|join|update|into|on|references)\s$/i,
	ENTITY_TYPE: /\bcreate.*(procedure|function|view|table)\s/i,
	INDEX_TYPE: /\b(key|index)\s*$/i,
	WITH_CLAUSE: /\bwith\s+(recursive\s+)?/i,
	SELECT_EXPR: /\bselect\s+\(.*\)/i,
	CAST_EXPR: /::decimal\s*\(|::numeric\s*\(/i
}

/**
 * Checks if a string appears to be a SQL expression with parentheses rather than a function call.
 * @param {string} prefix - The text preceding a potential function call.
 * @param {string} name - The name of the potential function.
 * @returns {boolean} True if this appears to be an expression, not a function call.
 */
export function isSqlExpression(prefix, name) {
	// Common SQL keywords that might precede expressions with parentheses
	const expressionKeywords = [
		'select',
		'where',
		'having',
		'case',
		'when',
		'then',
		'else',
		'coalesce',
		'nullif',
		'cast',
		'extract',
		'substring',
		'avg',
		'sum',
		'count',
		'max',
		'min'
	]
	const lowerPrefix = prefix.toLowerCase().trim()
	const lowerName = name.toLowerCase().trim()

	// If the function name itself is a built-in SQL function, treat as expression
	if (expressionKeywords.includes(lowerName)) {
		return true
	}
	// Special cases for function call contexts, not expressions
	if (
		lowerPrefix === 'values (' ||
		lowerPrefix.endsWith(' values (') ||
		lowerPrefix === '' ||
		lowerPrefix === 'values'
	) {
		return false
	}

	// Special case for SQL keywords that shouldn't be treated as expressions
	if (/^(then|when|case|from)\b/i.test(name)) {
		return false
	}

	// Special case for SQL keywords that shouldn't be treated as expressions
	if (/^(then|when|case|from)\b/i.test(name)) {
		return false
	}
	// Special case for CASE...WHEN...THEN...SELECT
	if (
		lowerPrefix.includes('when') &&
		lowerPrefix.includes('then') &&
		name.toLowerCase() === 'select'
	) {
		return true
	}

	// Check for common SQL expression patterns
	if (expressionKeywords.some((keyword) => lowerPrefix.endsWith(keyword))) {
		return true
	}

	// Check for operators that often precede expressions
	const operators = ['+', '-', '*', '/', '%', '=', '!=', '<', '>', '<=', '>=', '(']
	if (operators.some((op) => lowerPrefix.endsWith(op))) {
		return true
	}

	// Check for cast operators or other SQL expressions
	if (
		lowerPrefix.endsWith('::') ||
		lowerPrefix.includes('::') ||
		lowerPrefix.endsWith('as') ||
		lowerPrefix.includes(' as ')
	) {
		return true
	}

	// Check for decimal cast patterns
	if (/::\s*decimal\s*\(|::\s*numeric\s*\(/.test(lowerPrefix)) {
		return true
	}

	// Check for aggregate functions in SQL
	if (/\b(sum|avg|min|max|count)\s*$/.test(lowerPrefix)) {
		return true
	}

	return false
}

/**
 * Extracts function call references from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array} An array of references with their types.
 */
export function extractReferences(sqlScript) {
	// Preprocess SQL to remove comment blocks that might interfere with parsing
	const processedSql = removeCommentBlocks(sqlScript)

	// Get WITH aliases first to exclude them from function references
	const withAliases = extractWithAliases(processedSql)

	// We'll handle table references separately to avoid circular dependencies
	// Extract only FROM references without using extractTableReferences
	// const fromPattern = new RegExp(`\\bfrom\\s+${SCHEMA_GROUP}${ENTITY_GROUP}\\s*[;\\)]?`, 'gim')
	// const tableRefs = new Set()

	// let fromMatch = {}
	// while ((fromMatch = fromPattern.exec(processedSql)) !== null) {
	// 	const { schema, name } = fromMatch.groups
	// 	if (name && !withAliases.includes(name)) {
	// 		const fullName = schema ? schema + '.' + name : name
	// 		if (!isInternal(fullName)) {
	// 			tableRefs.add(fullName)
	// 		}
	// 	}
	// }

	// Matches function calls with optional schema prefixes
	const pattern = new RegExp(FUNCTION_CALL_PATTERN, 'gim')
	let functionCalls = {}
	let match = {}

	while ((match = pattern.exec(processedSql)) !== null) {
		const { prefix, schema, name } = match.groups

		// Skip if name is empty or undefined
		if (!name || !name.trim()) continue

		// Skip if this is a CTE alias
		if (withAliases.includes(name.trim())) continue

		// Skip if this appears to be a SQL expression rather than a function call
		if (isSqlExpression(prefix, name)) {
			continue
		}

		// Skip SELECT statements with parentheses
		if (
			prefix.toLowerCase().trim().endsWith('select') &&
			['coalesce', 'cast', 'count'].includes(name.toLowerCase())
		) {
			continue
		}

		// Skip casting expressions
		if (PATTERNS.CAST_EXPR.test(prefix)) {
			continue
		}

		const type = extractEntityType(prefix)
		const fullName = schema ? schema + '.' + name : name
		if (!isInternal(fullName)) functionCalls[fullName] = type
	}

	// Convert function calls to array of reference objects
	const funcRefs = Object.entries(functionCalls)
		.map(([name, type]) => ({ name, type }))
		.filter((x) => x.type !== 'index')

	// Add table references from FROM clauses
	// const tableReferences = Array.from(tableRefs).map((name) => ({ name, type: 'table/view' }))

	// Return combined references with no duplicates
	const allRefs = [...funcRefs]

	// Add table references that aren't already in function calls
	// for (const tableRef of tableReferences) {
	// 	if (!functionCalls[tableRef.name]) {
	// 		allRefs.push(tableRef)
	// 	}
	// }

	return allRefs
}

/**
 * Extracts table names on which a trigger is applied
 *
 * @param {*} sqlScript
 * @returns
 */
export function extractTriggerReferences(sqlScript) {
	// First, remove comment blocks to avoid false positives
	const cleanedSql = removeCommentBlocks(sqlScript)

	const pattern = new RegExp(TRIGGER_PATTERN, 'gim')
	// Normalize whitespace to handle multi-line statements
	const content = cleanedSql.replaceAll('\n', ' ').replaceAll('\r', ' ')
	let triggers = new Set()
	let match = {}

	while ((match = pattern.exec(content)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) {
			triggers.add(name.trim())
		}
	}

	return Array.from(triggers).map((name) => ({ name, type: 'table' }))
}
/**
 * Extracts the entity type from an input string.
 * @param {string} input - The input string.
 * @returns {string|null} The entity type or null if not found.
 */
export function extractEntityType(input) {
	let match = PATTERNS.ENTITY_TYPE.exec(input)
	if (match) return match[1]

	match = PATTERNS.TABLE_TYPE.exec(input)
	if (match) return 'table/view'
	match = PATTERNS.ALIAS_TYPE.exec(input)
	if (match) return 'alias'
	match = PATTERNS.INDEX_TYPE.exec(input)
	if (match) return 'index'

	return null
}

/**
 * Extracts the search paths from content.
 * @param {string} content - The content.
 * @param {string} [defaultPath='public'] - The default path.
 * @returns {Array<string>} An array of search paths.
 */
export function extractSearchPaths(content, defaultPath = 'public') {
	const matches = content.match(/SET\s+search_path\s*to\s*([a-z0-9_]+(,\s*)?)+;/gi)
	if (matches) {
		return matches[matches.length - 1]
			.split('to ')[1]
			.replaceAll(';', '')
			.split(',')
			.map((p) => p.trim())
	}
	return [defaultPath]
}

/**
 * Extracts WITH aliases from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array<string>} An array of aliases.
 */
export function extractWithAliases(sqlScript) {
	// First, remove comment blocks
	const cleanedSql = removeCommentBlocks(sqlScript)

	// Improved pattern to handle both simple WITH and WITH RECURSIVE
	const pattern = new RegExp(`with\\s+(recursive\\s+)?${ENTITY_GROUP}\\s+as`, 'gim')
	let aliases = new Set([])
	let match = {}

	// Process multi-line WITH statements by normalizing whitespace
	// Replace newlines and tabs with spaces to handle multi-line statements
	const normalizedSql = cleanedSql.replace(/[\n\r\t]+/g, ' ')

	// Find all WITH clause aliases
	while ((match = pattern.exec(normalizedSql)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) {
			aliases.add(name.trim())
		}
	}

	// Also extract CTE aliases from comma-separated WITH clauses
	const commaPattern = new RegExp(`,\\s*${ENTITY_GROUP}\\s+as`, 'gim')
	while ((match = commaPattern.exec(normalizedSql)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) {
			aliases.add(name.trim())
		}
	}

	return Array.from(aliases)
}

/**
 * Extracts table references from an SQL script.
 * @param {string} sqlScript - The SQL script.
 * @returns {Array} An array of table references with their types.
 */
export function extractTableReferences(sqlScript) {
	// Preprocess SQL to remove comment blocks
	const processedSql = removeCommentBlocks(sqlScript)

	const pattern = new RegExp(TABLE_REF_PATTERN, 'gim')
	let tableReferences = new Set()
	let match = {}
	let aliases = extractWithAliases(processedSql)

	// Process regular table references

	while ((match = pattern.exec(processedSql)) !== null) {
		const { schema, name, extra } = match.groups
		// console.log(extra, schema, name)
		// verify that extract function is not in the extra string
		const hasExtract =
			extra?.toLowerCase().includes('extract') && !extra?.toLowerCase().includes('from')
		// if (hasExtract) {
		// 	console.log(extra)
		// }
		if (name && !aliases.includes(name) && !hasExtract) {
			const fullName = schema ? schema + '.' + name : name
			tableReferences.add(fullName)
		}
	}
	// console.log(tableReferences)
	return Array.from(tableReferences)
		.filter((name) => !isInternal(name))
		.map((name) => ({ name, type: 'table/view' }))
}

/**
 * Extracts the entity information from a script.
 * @param {string} script - The script content.
 * @returns {Object} The extracted entity information.
 */
export function extractEntity(script) {
	// Preprocess script to remove comment blocks
	const processedScript = removeCommentBlocks(script)

	const pattern = new RegExp(CREATE_ENTITY_PATTERN, 'gim')
	const match = pattern.exec(processedScript)
	const { type, name, schema } = pick(['type', 'schema', 'name'], match?.groups ?? {})
	return { type: type?.toLowerCase(), name, schema }
}

/**
 * Parses an entity script and extracts relevant information.
 * @param {Object} entity - The entity object.
 * @returns {Object} The parsed entity information.
 */
export function parseEntityScript(entity) {
	const content = fs.readFileSync(entity.file, 'utf-8')
	const searchPaths = extractSearchPaths(content)
	let info = extractEntity(content)

	// Extract aliases first to improve reference detection
	const withAliases = extractWithAliases(content)

	// Get all references, ensuring CTE aliases are properly excluded
	let references = uniq([
		...extractReferences(content),
		...extractTableReferences(content),
		...extractTriggerReferences(content)
	])

	let errors = []
	if (!info.name)
		return {
			...entity,
			references: [],
			errors: ['Entity name not found in script']
		}
	if (!info.schema) info.schema = searchPaths[0]
	let fullName = info.schema + '.' + info.name

	if (info.schema !== entity.schema) errors.push('Schema in script does not match file path')
	if (info.type !== entity.type) errors.push('Entity type in script does not match file path')
	if (fullName !== entity.name) errors.push('Entity name in script does not match file name')

	const excludeEntity = [info.name, fullName]
	info.name = fullName

	// Ensure WITH aliases are properly excluded from references
	references = references
		.filter(({ type }) => type !== 'alias')
		.filter(({ name }) => !excludeEntity.includes(name))
		.filter(({ name }) => {
			const simpleName = name.split('.').pop()
			return (
				!withAliases.includes(name) &&
				!withAliases.includes(simpleName) &&
				// Also check case-insensitive match for aliases
				!withAliases.some((alias) => alias.toLowerCase() === simpleName.toLowerCase())
			)
		})

	return { ...entity, ...info, searchPaths, references, errors }
}

/**
 * Generate a lookup tree for the given entities
 * @param {Array} entities - An array of entities
 * @returns {Object} A lookup tree
 */
export function generateLookupTree(entities) {
	return entities.reduce(
		(cur, entity) => ({
			...cur,
			[entity.name]: pick(['name', 'schema', 'type'], entity)
		}),
		{}
	)
}

/**
 * Match and resolve references for given entities.
 * @param {Array} entities - An array of entities.
 * @param {Array} [extensions=[]] - An array of extensions.
 * @returns {Array} The entities with matched references.
 */
export function matchReferences(entities, extensions = []) {
	const lookup = generateLookupTree(entities)

	return entities.map((entity) => {
		let references = entity.references.map((ref) =>
			findEntityByName(ref, entity.searchPaths, lookup, extensions)
		)
		return {
			...entity,
			references,
			refers: references
				.filter((r) => !r.error)
				.filter((r) => r.type !== 'extension')
				.filter((r) => allowedTypes.includes(r.type))
				.map((r) => r.name)
		}
	})
}

/**
 * Find an entity by name within search paths and lookup.
 * @param {Object} ref - The reference object containing name and type.
 * @param {Array} searchPaths - An array of search paths.
 * @param {Object} lookup - The lookup object.
 * @param {Array} [extensions=[]] - An array of extensions.
 * @returns {Object} The matched entity or an error object if not found.
 */
export function findEntityByName({ name, type }, searchPaths, lookup, extensions = []) {
	let matched = null
	let internalType = isInternal(name, extensions)
	if (internalType) return { name, type: internalType }

	if (name.indexOf('.') > 0) {
		internalType = isInternal(name.split('.').pop(), extensions)
		if (internalType) return { name, type: internalType }

		matched = lookup[name]
		return matched ? matched : { name, type, error: `Reference ${name} not found` }
	}

	for (let i = 0; i < searchPaths.length && !matched; i++) {
		matched = lookup[searchPaths[i] + '.' + name]
	}
	return matched
		? matched
		: {
				name,
				type,
				error: `Reference ${name} not found in [${searchPaths.join(', ')}]`
			}
}

/**
 * Removes index creation statements from a DDL script.
 * @param {string} ddlText - The DDL script.
 * @returns {string} The DDL script without index creation statements.
 */
export function removeIndexCreationStatements(ddlText) {
	const indexCreationRegex = /create\s+(.+)?index[\s\S]*?;\n?/gim
	const result = ddlText.replace(indexCreationRegex, '')

	return result
}

/**
 * Normalize the comment string.
 * @param {string} inputString - The input string.
 * @returns {string} The normalized comment string.
 */
export function normalizeComment(inputString) {
	const regex = /comment on table\s+(\w+)\s+IS\s*'([^']*)';/i
	return inputString.replace(regex, (match, tableName, commentContent) => {
		// Replace newline characters with spaces
		const singleLineComment = commentContent.replace(/\n/g, '\\n').replace(/[\r]+/g, '')
		return `comment on table ${tableName} IS '${singleLineComment.trim()}';`
	})
}

/**
 * Cleanup DDL for DBML conversion.
 * @param {string} ddlText - The DDL script.
 * @returns {string} The cleaned up DDL script.
 */
export function cleanupDDLForDBML(ddlText) {
	if (!ddlText) return ddlText
	let cleaned = removeIndexCreationStatements(ddlText)
	return cleaned
}
