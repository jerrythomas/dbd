/**
 * Reference extraction — legacy regex-based reference finder.
 *
 * Extracted from src/parser.js + src/exclusions.js.
 * Finds function calls, table references, and trigger references in SQL scripts
 * for dependency resolution.
 */
import fs from 'fs'
import { pick, uniq } from 'ramda'
import { allowedTypes } from '@jerrythomas/dbd-db'

// --- Exclusion patterns (from src/exclusions.js) ---

let cache = {
	internal: [],
	extension: []
}

export const extensions = {
	'uuid-ossp': { patterns: ['^uuid_'] },
	cube: { patterns: ['^cube(_.*)?'] },
	timescaledb: { entities: ['create_hypertable', 'time_bucket'] },
	pgcrypto: { entities: ['gen_salt', 'crypt', 'md5'] },
	postgis: { patterns: ['^st_', '^geom_', '^geog'] },
	pg_trgm: { entities: ['similarity'] },
	vector: { entities: ['vector', 'gin', 'hnsw', 'ivfflat'] },
	pgmq: { patterns: ['^pgmq_', '^pgmq\\.'] },
	pg_cron: { patterns: ['^cron\\.'] },
	dblink: { entities: ['dblink', 'dblink_exec', 'dblink_connect', 'dblink_disconnect'] },
	pg_background: { entities: ['pg_background_launch', 'pg_background_result'] }
}

export const internals = {
	ansii: {
		entities: [
			'avg',
			'count',
			'min',
			'max',
			'abs',
			'sum',
			'floor',
			'where',
			'ceil',
			'random',
			'upper',
			'lower',
			'substring',
			'substr',
			'trim',
			'getdate',
			'datepart',
			'greatest',
			'least',
			'datediff',
			'cast',
			'convert',
			'coalesce',
			'rank',
			'row_number',
			'dense_rank',
			'over',
			'partition',
			'by',
			'list',
			'values',
			'count',
			'string_agg',
			'split_part',
			'format',
			'first_value',
			'last_value',
			'lag',
			'lead',
			'percent_rank',
			'cume_dist',
			'exists',
			'set',
			'varchar',
			'join',
			'inner',
			'outer',
			'in',
			'on',
			'from',
			'as',
			'replace',
			'key',
			'least',
			'replace',
			'initcap',
			'check',
			'using',
			'unique',
			'and',
			'or',
			'nullif',
			'if',
			'array',
			'tinyint',
			'bigint',
			'double',
			'bit',
			'varbinary',
			'btree',
			'int',
			'numeric',
			'bytea',
			'table',
			'column',
			'trunc',
			'geometry',
			'vector',
			'gin',
			'for',
			'threshold',
			'length',
			'decimal',
			'position',
			'not',
			'date',
			'round',
			'when',
			'record',
			'between',
			'columns',
			'default',
			'system',
			'user'
		]
	},
	postgres: {
		patterns: [
			'^information_schema.',
			'^pg_',
			'^array_',
			'^string_to_',
			'^to_',
			'^date_',
			'^time_',
			'^json_',
			'^jsonb_',
			'^xml_',
			'^regexp_',
			'^lo_',
			'^current_'
		],
		entities: [
			'varying',
			'now',
			'localtime',
			'localtimestamp',
			'string_agg',
			'unnest',
			'initcap',
			'extract',
			'conflict',
			'date_part',
			'return',
			'enum'
		]
	}
}

export function isAnsiiSQL(input) {
	return internals.ansii.entities.includes(input) ? 'internal' : null
}

export function isPostgres(input) {
	let matched = internals.postgres.entities.includes(input)
	if (!matched) {
		for (let i = 0; i < internals.postgres.patterns.length && !matched; i++) {
			let regex = new RegExp(internals.postgres.patterns[i])
			matched = regex.test(input)
		}
	}
	return matched ? 'internal' : null
}

export function isExtension(input, installed = []) {
	let matched = false
	for (let i = 0; i < installed.length && !matched; i++) {
		const extension = extensions[installed[i]]
		if (!extension) continue
		if (Array.isArray(extension.entities)) {
			matched = extension.entities.includes(input)
		}
		if (!matched && Array.isArray(extension.patterns)) {
			for (let j = 0; j < extension.patterns.length && !matched; j++) {
				let regex = new RegExp(extension.patterns[j])
				matched = regex.test(input)
			}
		}
	}
	return matched ? 'extension' : null
}

/**
 * Check if an input matches ANY known extension (regardless of whether it's installed).
 * Returns the extension name if matched, null otherwise.
 */
export function matchesKnownExtension(input) {
	const lowerInput = input.toLowerCase()
	for (const [extName, extension] of Object.entries(extensions)) {
		if (Array.isArray(extension.entities) && extension.entities.includes(lowerInput)) {
			return extName
		}
		if (Array.isArray(extension.patterns)) {
			for (const pattern of extension.patterns) {
				if (new RegExp(pattern).test(lowerInput)) return extName
			}
		}
	}
	return null
}

export function isInternal(input, installed = []) {
	const lowerInput = input.toLowerCase()

	if (cache.internal.includes(lowerInput)) return 'internal'
	if (cache.extension.includes(lowerInput)) return 'extension'

	let matched =
		isAnsiiSQL(lowerInput) || isPostgres(lowerInput) || isExtension(lowerInput, installed)

	if (matched === 'internal') {
		cache.internal.push(lowerInput)
	} else if (matched === 'extension') {
		cache.extension.push(lowerInput)
	}

	return matched
}

export function getCache() {
	return cache
}

export function resetCache() {
	cache = {
		internal: [],
		extension: []
	}
}

// --- Regex patterns (from src/parser.js) ---

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

// --- Comment/cleanup utilities ---

export function removeCommentBlocks(sqlScript) {
	const commentOnRegex = /comment\s+on\s+.*\s+is\s*('[^']*'|"[^"]*");/gis
	const lineCommentRegex = /--[^\n]*(\n|$)/g
	const blockCommentRegex = /\/\*[\s\S]*?\*\//g

	return sqlScript
		.replace(commentOnRegex, '-- COMMENT_PLACEHOLDER;')
		.replace(lineCommentRegex, '\n')
		.replace(blockCommentRegex, ' ')
}

export function removeIndexCreationStatements(ddlText) {
	const indexCreationRegex = /create\s+(.+)?index[\s\S]*?;\n?/gim
	return ddlText.replace(indexCreationRegex, '')
}

export function normalizeComment(inputString) {
	const regex = /comment on table\s+(\w+)\s+IS\s*'([^']*)';/i
	return inputString.replace(regex, (match, tableName, commentContent) => {
		const singleLineComment = commentContent.replace(/\n/g, '\\n').replace(/[\r]+/g, '')
		return `comment on table ${tableName} IS '${singleLineComment.trim()}';`
	})
}

export function cleanupDDLForDBML(ddlText) {
	if (!ddlText) return ddlText
	let cleaned = removeIndexCreationStatements(ddlText)
	return cleaned
}

// --- Expression detection ---

export function isSqlExpression(prefix, name) {
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

	if (expressionKeywords.includes(lowerName)) return true
	if (
		lowerPrefix === 'values (' ||
		lowerPrefix.endsWith(' values (') ||
		lowerPrefix === '' ||
		lowerPrefix === 'values'
	)
		return false
	if (/^(then|when|case|from)\b/i.test(name)) return false
	if (
		lowerPrefix.includes('when') &&
		lowerPrefix.includes('then') &&
		name.toLowerCase() === 'select'
	)
		return true
	if (expressionKeywords.some((keyword) => lowerPrefix.endsWith(keyword))) return true

	const operators = ['+', '-', '*', '/', '%', '=', '!=', '<', '>', '<=', '>=', '(']
	if (operators.some((op) => lowerPrefix.endsWith(op))) return true
	if (
		lowerPrefix.endsWith('::') ||
		lowerPrefix.includes('::') ||
		lowerPrefix.endsWith('as') ||
		lowerPrefix.includes(' as ')
	)
		return true
	if (/::\s*decimal\s*\(|::\s*numeric\s*\(/.test(lowerPrefix)) return true
	if (/\b(sum|avg|min|max|count)\s*$/.test(lowerPrefix)) return true

	return false
}

// --- Extraction functions ---

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

export function extractWithAliases(sqlScript) {
	const cleanedSql = removeCommentBlocks(sqlScript)
	const pattern = new RegExp(`with\\s+(recursive\\s+)?${ENTITY_GROUP}\\s+as`, 'gim')
	let aliases = new Set([])
	let match = {}

	const normalizedSql = cleanedSql.replace(/[\n\r\t]+/g, ' ')

	while ((match = pattern.exec(normalizedSql)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) aliases.add(name.trim())
	}

	const commaPattern = new RegExp(`,\\s*${ENTITY_GROUP}\\s+as`, 'gim')
	while ((match = commaPattern.exec(normalizedSql)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) aliases.add(name.trim())
	}

	return Array.from(aliases)
}

export function extractReferences(sqlScript) {
	const processedSql = removeCommentBlocks(sqlScript)
	const withAliases = extractWithAliases(processedSql)

	const pattern = new RegExp(FUNCTION_CALL_PATTERN, 'gim')
	let functionCalls = {}
	let match = {}

	while ((match = pattern.exec(processedSql)) !== null) {
		const { prefix, schema, name } = match.groups

		if (!name || !name.trim()) continue
		if (withAliases.includes(name.trim())) continue
		if (isSqlExpression(prefix, name)) continue
		if (
			prefix.toLowerCase().trim().endsWith('select') &&
			['coalesce', 'cast', 'count'].includes(name.toLowerCase())
		)
			continue
		if (PATTERNS.CAST_EXPR.test(prefix)) continue

		const type = extractEntityType(prefix)
		const fullName = schema ? schema + '.' + name : name
		if (!isInternal(fullName)) functionCalls[fullName] = type
	}

	const funcRefs = Object.entries(functionCalls)
		.map(([name, type]) => ({ name, type }))
		.filter((x) => x.type !== 'index')

	return [...funcRefs]
}

export function extractTriggerReferences(sqlScript) {
	const cleanedSql = removeCommentBlocks(sqlScript)
	const pattern = new RegExp(TRIGGER_PATTERN, 'gim')
	const content = cleanedSql.replaceAll('\n', ' ').replaceAll('\r', ' ')
	let triggers = new Set()
	let match = {}

	while ((match = pattern.exec(content)) !== null) {
		const { name } = match.groups
		if (name && name.trim()) triggers.add(name.trim())
	}

	return Array.from(triggers).map((name) => ({ name, type: 'table' }))
}

export function extractTableReferences(sqlScript) {
	const processedSql = removeCommentBlocks(sqlScript)
	const pattern = new RegExp(TABLE_REF_PATTERN, 'gim')
	let tableReferences = new Set()
	let match = {}
	let aliases = extractWithAliases(processedSql)

	while ((match = pattern.exec(processedSql)) !== null) {
		const { schema, name, extra } = match.groups
		const hasExtract =
			extra?.toLowerCase().includes('extract') && !extra?.toLowerCase().includes('from')

		if (name && !aliases.includes(name) && !hasExtract) {
			const fullName = schema ? schema + '.' + name : name
			tableReferences.add(fullName)
		}
	}

	return Array.from(tableReferences)
		.filter((name) => !isInternal(name))
		.map((name) => ({ name, type: 'table/view' }))
}

export function extractEntity(script) {
	const processedScript = removeCommentBlocks(script)
	const pattern = new RegExp(CREATE_ENTITY_PATTERN, 'gim')
	const match = pattern.exec(processedScript)
	const { type, name, schema } = pick(['type', 'schema', 'name'], match?.groups ?? {})
	return { type: type?.toLowerCase(), name, schema }
}

// --- Entity-level reference parsing ---

export function parseEntityScript(entity) {
	const content = fs.readFileSync(entity.file, 'utf-8')
	const searchPaths = extractSearchPaths(content)
	let info = extractEntity(content)

	const withAliases = extractWithAliases(content)

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

	references = references
		.filter(({ type }) => type !== 'alias')
		.filter(({ name }) => !excludeEntity.includes(name))
		.filter(({ name }) => {
			const simpleName = name.split('.').pop()
			return (
				!withAliases.includes(name) &&
				!withAliases.includes(simpleName) &&
				!withAliases.some((alias) => alias.toLowerCase() === simpleName.toLowerCase())
			)
		})

	return { ...entity, ...info, searchPaths, references, errors }
}

export function generateLookupTree(entities) {
	return entities.reduce(
		(cur, entity) => ({
			...cur,
			[entity.name]: pick(['name', 'schema', 'type'], entity)
		}),
		{}
	)
}

export function findEntityByName({ name, type }, searchPaths, lookup, installed = []) {
	let matched = null
	let internalType = isInternal(name, installed)
	if (internalType) return { name, type: internalType }

	if (name.indexOf('.') > 0) {
		internalType = isInternal(name.split('.').pop(), installed)
		if (internalType) return { name, type: internalType }

		matched = lookup[name]
		if (matched) return matched

		// Check if it matches a known extension (declared or not)
		const extName = matchesKnownExtension(name) || matchesKnownExtension(name.split('.').pop())
		if (extName) {
			if (installed.includes(extName)) {
				return { name, type: 'extension' }
			}
			return {
				name,
				type,
				warning: `Reference ${name} may require undeclared extension '${extName}'`
			}
		}

		return { name, type, warning: `Reference ${name} not found` }
	}

	for (let i = 0; i < searchPaths.length && !matched; i++) {
		matched = lookup[searchPaths[i] + '.' + name]
	}
	if (matched) return matched

	// Check if it matches a known extension
	const extName = matchesKnownExtension(name)
	if (extName) {
		if (installed.includes(extName)) {
			return { name, type: 'extension' }
		}
		return {
			name,
			type,
			warning: `Reference ${name} may require undeclared extension '${extName}'`
		}
	}

	return {
		name,
		type,
		warning: `Reference ${name} not found in [${searchPaths.join(', ')}]`
	}
}

export function matchReferences(entities, extensions = []) {
	const lookup = generateLookupTree(entities)

	return entities.map((entity) => {
		let references = entity.references.map((ref) =>
			findEntityByName(ref, entity.searchPaths, lookup, extensions)
		)
		const warnings = references.filter((r) => r.warning).map((r) => r.warning)
		return {
			...entity,
			references,
			warnings: [...(entity.warnings || []), ...warnings],
			refers: references
				.filter((r) => !r.error && !r.warning)
				.filter((r) => r.type !== 'extension')
				.filter((r) => allowedTypes.includes(r.type))
				.map((r) => r.name)
		}
	})
}
